(() => {
  "use strict";

  // ────────────────────────────────────────────────
  // 設定
  // ────────────────────────────────────────────────

  let MAX_FLOW_COMMENTS = 30;       // auth_success で上書き
  const FIXED_DISPLAY_MS  = 5000;  // 上下固定の表示時間（ms）

  // 速度: 画面幅 / DIVISOR = px/秒
  const SPEED_DIVISOR_MIN = 2.5;
  const SPEED_DIVISOR_MAX = 5.0;
  const CHAR_THRESHOLD    = 30;

  const SIZE_CONFIG = {
    big:    { vh: 12 },
    medium: { vh:  6 },
    small:  { vh:  3 },
  };

  // セッションエフェクト
  const sessionEffects = new Set();

  // 衝突判定用
  const activeRects = [];
  const RECT_MARGIN = 4;

  // 固定スロット
  const FIXED_MAX_SLOTS = 20;
  const fixedSlots = {
    ue:    new Array(FIXED_MAX_SLOTS).fill(null),
    shita: new Array(FIXED_MAX_SLOTS).fill(null),
  };

  let aesKey    = null;
  let flowCount = 0;

  // ── DOM ─────────────────────────────────────────
  const authScreen      = document.getElementById("auth-screen");
  const authCodeDisplay = document.getElementById("auth-code-display");
  const stage           = document.getElementById("stage");

  // ────────────────────────────────────────────────
  // ★ 修正1: 画面サイズ取得
  //
  // Linux の OBS ブラウザソース（CEF）では window.innerHeight / innerWidth が
  // 初期化タイミングによって 0 を返すケースがある。
  // → stage 要素の getBoundingClientRect() をフォールバックとして使い、
  //   それも 0 なら OBS のデフォルト解像度（1920×1080）を仮定する。
  // ────────────────────────────────────────────────
  function getScreenSize() {
    let W = window.innerWidth;
    let H = window.innerHeight;

    if (!W || !H) {
      const r = stage.getBoundingClientRect();
      W = r.width  || document.documentElement.clientWidth  || 1920;
      H = r.height || document.documentElement.clientHeight || 1080;
    }
    return { W: W || 1920, H: H || 1080 };
  }

  // ────────────────────────────────────────────────
  // Socket.io
  // ────────────────────────────────────────────────

  const token  = new URLSearchParams(location.search).get("token");
  const socket = io({ query: { token } });

  // ────────────────────────────────────────────────
  // WebCrypto
  // ────────────────────────────────────────────────

  function hexToBytes(hex) {
    const bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
    }
    return bytes;
  }

  async function importKey(keyHex) {
    return crypto.subtle.importKey(
      "raw", hexToBytes(keyHex), { name: "AES-GCM" }, false, ["decrypt"],
    );
  }

  async function decryptPayload(raw, key) {
    const [ivHex, tagHex, ctHex] = raw.split(":");
    const iv  = hexToBytes(ivHex);
    const tag = hexToBytes(tagHex);
    const ct  = hexToBytes(ctHex);
    const combined = new Uint8Array(ct.length + tag.length);
    combined.set(ct, 0);
    combined.set(tag, ct.length);
    const dec = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, tagLength: 128 }, key, combined,
    );
    return JSON.parse(new TextDecoder().decode(dec));
  }

  // ────────────────────────────────────────────────
  // ユーティリティ
  // ────────────────────────────────────────────────

  /**
   * ★ 修正2: vh → px 変換
   *
   * 元のコードは window.innerHeight を直接使っていたが、
   * Linux OBS CEF では innerHeight が 0 を返す場合がある。
   * getScreenSize() 経由で安全に H を取得する。
   */
  function vhToPx(vh) {
    const { H } = getScreenSize();
    return Math.round(H * vh / 100);
  }

  /** 速度計算（px/秒） */
  function calcSpeed(charCount) {
    const { W } = getScreenSize();
    const r       = Math.min(charCount, CHAR_THRESHOLD) / CHAR_THRESHOLD;
    const divisor = SPEED_DIVISOR_MIN + (SPEED_DIVISOR_MAX - SPEED_DIVISOR_MIN) * (1 - r);
    return W / divisor;
  }

  // ────────────────────────────────────────────────
  // Socket イベント
  // ────────────────────────────────────────────────

  socket.on("connect", () => {
    console.log("[overlay] 接続確立 id=", socket.id);
    socket.emit("client_ready");
  });

  if (socket.connected) socket.emit("client_ready");

  socket.on("auth_code", ({ code }) => {
    authCodeDisplay.textContent = String(code);
    console.log("[overlay] 認証コード:", code);
  });

  socket.on("auth_success", async ({ key, maxComments }) => {
    try {
      aesKey            = await importKey(key);
      MAX_FLOW_COMMENTS = maxComments;
      authScreen.style.display = "none";
      console.log("[overlay] 認証完了 maxComments=", maxComments);
    } catch (e) {
      console.error("[overlay] 鍵エラー:", e);
      showAuthError("鍵の設定に失敗しました");
    }
  });

  socket.on("update_limit", ({ maxComments }) => {
    MAX_FLOW_COMMENTS = maxComments;
  });

  socket.on("apply_secret", ({ effect, value }) => {
    if (value) sessionEffects.add(effect);
    else       sessionEffects.delete(effect);
    console.log("[overlay] sessionEffects:", [...sessionEffects]);
  });

  socket.on("message", async (enc) => {
    if (!aesKey) return;
    try {
      const p = await decryptPayload(enc, aesKey);

      if (p.sessionFx?.length > 0) {
        for (const fx of p.sessionFx) sessionEffects.add(fx);
      }

      if (p.msgCommands?.includes("invisible")) return;

      if (p.position === "ue" || p.position === "shita") {
        renderFixed(p);
      } else {
        renderFlow(p);
      }
    } catch (e) {
      console.error("[overlay] 復号エラー:", e);
    }
  });

  socket.on("error_msg", ({ code, message }) => {
    console.error("[overlay] エラー:", code, message);
    showAuthError(message);
  });

  socket.on("disconnect", () => {
    aesKey = null;
    sessionEffects.clear();
    for (const side of ["ue", "shita"]) {
      fixedSlots[side].forEach((s) => { if (s) { clearTimeout(s.timerId); s.el.remove(); } });
      fixedSlots[side].fill(null);
    }
    authCodeDisplay.textContent = "------";
    authCodeDisplay.style.color = "#57f287";
    authScreen.style.display    = "flex";
  });

  socket.on("connect_error", (e) => {
    console.error("[overlay] 接続エラー:", e.message);
    setTimeout(() => { if (socket.connected) socket.emit("request_code"); }, 1000);
  });

  // ────────────────────────────────────────────────
  // 認証エラー表示
  // ────────────────────────────────────────────────

  function showAuthError(msg) {
    authCodeDisplay.textContent = "ERROR";
    authCodeDisplay.style.color = "#ed4245";
    const old = authScreen.querySelector(".error");
    if (old) old.remove();
    const p       = document.createElement("p");
    p.className   = "error";
    p.textContent = msg;
    authScreen.appendChild(p);
  }

  // ────────────────────────────────────────────────
  // パーツ要素生成
  // ────────────────────────────────────────────────

  /**
   * ★ 修正3: 色の適用
   *
   * 元のコードは span.style.color = payload.color を設定していたが、
   * Linux OBS CEF では特定の条件でインラインスタイルが無視されることがある。
   *
   * 対策:
   *  - style.setProperty("color", value, "important") で強制上書き
   *  - gaming エフェクト判定を正確に行い、gaming 時のみ color を設定しない
   */
  function buildParts(payload, forFixed = false) {
    const sizeKey = (payload.size && SIZE_CONFIG[payload.size])
      ? payload.size
      : "medium";

    const sizePx    = vhToPx(SIZE_CONFIG[sizeKey].vh);
    const emojiPx   = sizePx;
    const stickerPx = sizePx * 2;

    const hasGaming = sessionEffects.has("gaming") || (payload.sessionFx?.includes("gaming") ?? false);
    const isItalic  = payload.styles?.italic ?? false;

    const deco = [];
    if (payload.styles?.underline)     deco.push("underline");
    if (payload.styles?.strikethrough) deco.push("line-through");

    const lines = [[]];
    for (const part of payload.p) {
      if (part.type === "text") {
        part.content.split("\n").forEach((seg, i) => {
          if (i > 0) lines.push([]);
          lines[lines.length - 1].push({ type: "text", content: seg });
        });
      } else {
        lines[lines.length - 1].push(part);
      }
    }

    const frag = document.createDocumentFragment();

    for (const line of lines) {
      const row            = document.createElement("div");
      row.style.display    = "flex";
      row.style.alignItems = "center";
      row.style.gap        = "0.15em";
      row.style.minHeight  = `${Math.round(sizePx * 1.3)}px`;
      if (forFixed) row.style.justifyContent = "center";

      for (const part of line) {

        if (part.type === "text") {
          const span              = document.createElement("span");
          span.className          = "text-part";
          span.style.fontSize     = `${sizePx}px`;
          span.style.lineHeight   = "1.3";
          span.style.whiteSpace   = "pre";

          // ★ 修正3: color を !important で強制設定
          if (!hasGaming) {
            const color = payload.color || "#ffffff";
            span.style.setProperty("color", color, "important");
          }
          // gaming エフェクト時は color を設定しない（CSS animation が有効になる）

          span.textContent        = part.content;

          if (payload.styles?.bold)  span.style.fontWeight    = "bold";
          if (isItalic)              span.style.fontStyle      = "italic";
          if (deco.length > 0)       span.style.textDecoration = deco.join(" ");

          row.appendChild(span);

        } else if (part.type === "emoji") {
          const img               = document.createElement("img");
          img.className           = "emoji";
          img.src                 = part.content;
          img.alt                 = "";
          img.loading             = "lazy";
          img.style.height        = `${emojiPx}px`;
          img.style.width         = "auto";
          img.style.verticalAlign = "middle";
          img.style.display       = "inline-block";
          img.style.fontStyle     = "normal";
          img.style.transform     = "none";
          row.appendChild(img);

        } else if (part.type === "sticker") {
          const img               = document.createElement("img");
          img.className           = "sticker";
          img.src                 = part.content;
          img.alt                 = "";
          img.loading             = "lazy";
          img.style.height        = `${stickerPx}px`;
          img.style.width         = "auto";
          img.style.verticalAlign = "middle";
          img.style.display       = "inline-block";
          img.style.fontStyle     = "normal";
          img.style.transform     = "none";
          row.appendChild(img);
        }
      }

      frag.appendChild(row);
    }

    return frag;
  }

  // ────────────────────────────────────────────────
  // エフェクトクラス付与
  // ────────────────────────────────────────────────

  function applyEffectClasses(el, msgCommands, payloadSessionFx) {
    const all = new Set([...(payloadSessionFx ?? []), ...sessionEffects]);
    if (all.has("gaming")) el.classList.add("effect-gaming");
    if (all.has("loop"))   el.classList.add("effect-loop");
    if (msgCommands?.includes("_live")) el.classList.add("effect-live");
  }

  // ────────────────────────────────────────────────
  // 衝突判定
  // ────────────────────────────────────────────────

  function findFreeY(elH, minY, maxY) {
    const now = performance.now();
    for (let i = activeRects.length - 1; i >= 0; i--) {
      if (now > activeRects[i].expire) activeRects.splice(i, 1);
    }

    const step    = Math.max(2, Math.floor(elH / 4));
    const { H }   = getScreenSize();
    const safeMax = Math.min(maxY, H - elH);
    let bestY     = minY;
    let bestScore = -Infinity;

    for (let y = minY; y <= safeMax; y += step) {
      const bottom = y + elH;
      let collide  = false;
      let minGap   = Infinity;

      for (const r of activeRects) {
        const ot = Math.max(y - RECT_MARGIN,      r.top    - RECT_MARGIN);
        const ob = Math.min(bottom + RECT_MARGIN, r.bottom + RECT_MARGIN);
        if (ob > ot) { collide = true; minGap = Math.min(minGap, ob - ot); }
      }

      if (!collide) return y;
      const score = -minGap;
      if (score > bestScore) { bestScore = score; bestY = y; }
    }

    return Math.max(minY, Math.min(bestY, safeMax));
  }

  // ────────────────────────────────────────────────
  // 流れるコメント
  // ────────────────────────────────────────────────

  function renderFlow(payload) {
    if (flowCount >= MAX_FLOW_COMMENTS) return;

    const el            = document.createElement("div");
    el.className        = "comment";
    el.style.animation  = "none";
    el.style.visibility = "hidden";
    el.appendChild(buildParts(payload, false));

    const hasReverse = sessionEffects.has("reverse") || (payload.sessionFx?.includes("reverse") ?? false);

    stage.appendChild(el);
    flowCount++;

    requestAnimationFrame(() => {
      const { W, H } = getScreenSize();
      const elW      = el.offsetWidth;
      const elH      = el.offsetHeight;

      const minY = Math.round(H * 0.01);
      const maxY = Math.round(H * 0.98) - elH;
      const topY = findFreeY(elH, minY, maxY);

      const speed    = calcSpeed(payload.charCount ?? 10);
      const distance = W + elW;
      const duration = distance / speed;

      el.style.top = `${topY}px`;
      el.style.setProperty("--distance", `${distance}px`);
      el.style.setProperty("--duration",  `${duration}s`);

      if (hasReverse) {
        el.style.left = `-${elW}px`;
        const anim = el.animate(
          [{ transform: "translateX(0)" }, { transform: `translateX(${distance}px)` }],
          { duration: duration * 1000, easing: "linear", fill: "forwards" },
        );
        anim.onfinish = () => { el.remove(); flowCount--; };
      } else {
        // ★ 修正4: "100vw" の代わりに px 値を直接設定
        // Linux OBS CEF では vw 単位が正しく解釈されないケースがある
        el.style.left      = `${W}px`;
        el.style.animation = `flow ${duration}s linear forwards`;
        el.addEventListener("animationend", () => { el.remove(); flowCount--; }, { once: true });
      }

      const hasLoop = sessionEffects.has("loop") || (payload.sessionFx?.includes("loop") ?? false);
      if (hasLoop) {
        el.style.animation = `flow-loop ${duration}s linear infinite`;
      }

      applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

      el.style.visibility = "visible";

      activeRects.push({
        top:    topY,
        bottom: topY + elH,
        expire: performance.now() + duration * 1000 + 500,
      });
    });
  }

  // ────────────────────────────────────────────────
  // 固定コメント
  // ────────────────────────────────────────────────

  /**
   * ★ 修正5: 上下固定コメントの座標計算
   *
   * 元のコードは shita（下固定）でも top を計算して style.top に設定していた。
   * Linux OBS CEF では負の top や大きな top が正しく処理されない場合がある。
   *
   * 修正:
   *  - ue（上固定）   → style.top    に px を直接設定（変わらず）
   *  - shita（下固定）→ style.bottom に px を直接設定（new）
   *    element の bottom からの距離を計算することで負値を回避
   */
  function calcFixedPosition(side, slotIndex, elH) {
    const { H }   = getScreenSize();
    const slots   = fixedSlots[side];
    let offset    = 0;

    for (let i = 0; i < slotIndex; i++) {
      if (slots[i]) {
        offset += slots[i].height + RECT_MARGIN;
      }
    }

    if (side === "ue") {
      return { prop: "top",    value: offset };
    } else {
      // bottom プロパティで指定: 画面下端からのオフセット
      return { prop: "bottom", value: offset };
    }
  }

  function renderFixed(payload) {
    const side  = payload.position; // "ue" | "shita"
    const slots = fixedSlots[side];

    let slotIndex = slots.findIndex((s) => s === null);
    if (slotIndex === -1) {
      slotIndex = slots.length < FIXED_MAX_SLOTS ? slots.length : 0;
      if (slotIndex === 0) {
        const oldest = slots[0];
        if (oldest) {
          clearTimeout(oldest.timerId);
          oldest.el.remove();
          slots[0] = null;
        }
      }
    }

    const el            = document.createElement("div");
    el.className        = "comment-fixed";
    el.style.visibility = "hidden";

    // ★ 修正5: shita のとき top ではなく bottom を使うので
    //   先に top をリセットしておく（CSSクラスに top: auto を明示）
    if (side === "shita") {
      el.style.top    = "auto";
      el.style.bottom = "0px"; // 仮置き（rAF 内で上書き）
    }

    el.appendChild(buildParts(payload, true));
    applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

    stage.appendChild(el);

    requestAnimationFrame(() => {
      const elH      = el.offsetHeight || vhToPx(SIZE_CONFIG[payload.size ?? "medium"].vh) * 1.4;
      const pos      = calcFixedPosition(side, slotIndex, elH);

      // ★ top / bottom どちらを使うか分岐
      if (pos.prop === "top") {
        el.style.top    = `${pos.value}px`;
        el.style.bottom = "auto";
      } else {
        el.style.bottom = `${pos.value}px`;
        el.style.top    = "auto";
      }

      el.style.visibility = "visible";

      const entry = { el, height: elH, timerId: null };
      slots[slotIndex] = entry;

      entry.timerId = setTimeout(() => {
        el.remove();
        slots[slotIndex] = null;
      }, FIXED_DISPLAY_MS);
    });
  }

})();