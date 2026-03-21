(() => {
  "use strict";

  // ────────────────────────────────────────────────
  // 設定
  // ────────────────────────────────────────────────

  let MAX_FLOW_COMMENTS = 30;       // auth_success で上書き
  const FIXED_DISPLAY_MS  = 5000;  // 上下固定の表示時間（ms）

  // 速度: 画面幅 / DIVISOR = px/秒
  // 値が小さいほど速い
  const SPEED_DIVISOR_MIN = 2.5;   // 短文（速い）
  const SPEED_DIVISOR_MAX = 5.0;   // 長文（遅い）
  const CHAR_THRESHOLD    = 30;

  /*
   * テキストサイズ（vh単位）
   * 1vh = 画面高さの1%
   * OBS 1080p の場合:  big=130px / medium=65px / small=32px
   * OBS  720p の場合:  big= 86px / medium=43px / small=22px
   */
  const SIZE_CONFIG = {
    big:    { vh: 12 },
    medium: { vh:  6 },
    small:  { vh:  3 },
  };

  // セッションエフェクト（/secret コマンドで蓄積）
  const sessionEffects = new Set();

  // 衝突判定用
  const activeRects = [];
  const RECT_MARGIN = 4;

  // 固定スロット（詰めない・個別タイマー）
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

  /** vh → px 変換（window.innerHeight ベース） */
  function vhToPx(vh) {
    return Math.round(window.innerHeight * vh / 100);
  }

  /** 速度計算（px/秒） */
  function calcSpeed(charCount) {
    const W       = window.innerWidth;
    const r       = Math.min(charCount, CHAR_THRESHOLD) / CHAR_THRESHOLD;
    // 短文ほど速い（divisor が小さい）
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

      // セッションエフェクト蓄積
      if (p.sessionFx?.length > 0) {
        for (const fx of p.sessionFx) sessionEffects.add(fx);
      }

      // invisible: 描画しない
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
   * payload の p[] から DOM Fragment を生成する
   *
   * サイズ: SIZE_CONFIG の vh を window.innerHeight で px に変換して
   *        style.fontSize に直接セットする
   *        → CSS クラスによるサイズ制御を完全に廃止し JS で一元管理
   *
   * 斜体バグ: img 要素に fontStyle:"normal" / transform:"none" を明示
   *          → 親要素の italic が img に継承されない
   */
  function buildParts(payload, forFixed = false) {
    const sizeKey = (payload.size && SIZE_CONFIG[payload.size])
      ? payload.size
      : "medium";

    // ★ ここで px に変換して使う
    const sizePx  = vhToPx(SIZE_CONFIG[sizeKey].vh);
    const emojiPx = sizePx;             // 絵文字 = テキストと同じ高さ
    const stickerPx = sizePx * 2;       // スタンプ = テキストの2倍

    const hasGaming = sessionEffects.has("gaming") || (payload.sessionFx?.includes("gaming") ?? false);
    const isItalic  = payload.styles?.italic ?? false;

    const deco = [];
    if (payload.styles?.underline)     deco.push("underline");
    if (payload.styles?.strikethrough) deco.push("line-through");

    // テキストを行単位に分解
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
          // ★ font-size を px で直接セット（vh や em は使わない）
          span.style.fontSize     = `${sizePx}px`;
          span.style.lineHeight   = "1.3";
          span.style.whiteSpace   = "pre";
          span.style.color        = "#ffffff"; // デフォルト白
          span.textContent        = part.content;

          // 色（gaming が有効な場合は上書きしない）
          if (payload.color && !hasGaming) span.style.color = payload.color;

          if (payload.styles?.bold)  span.style.fontWeight     = "bold";
          if (isItalic)              span.style.fontStyle       = "italic";
          if (deco.length > 0)       span.style.textDecoration  = deco.join(" ");

          row.appendChild(span);

        } else if (part.type === "emoji") {
          const img               = document.createElement("img");
          img.className           = "emoji";
          img.src                 = part.content;
          img.alt                 = "";
          img.loading             = "lazy";
          // ★ 高さを px で直接セット
          img.style.height        = `${emojiPx}px`;
          img.style.width         = "auto";
          img.style.verticalAlign = "middle";
          img.style.display       = "inline-block";
          img.style.fontStyle     = "normal";   // 斜体継承リセット
          img.style.transform     = "none";      // 変形継承リセット
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
    const safeMax = Math.min(maxY, window.innerHeight - elH);
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
      const W      = window.innerWidth;
      const H      = window.innerHeight;
      const elW    = el.offsetWidth;
      const elH    = el.offsetHeight;

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
        el.style.left      = "100vw";
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
   * Y座標計算
   * ue:    index 0 = 最上段（top: 0）から下へ積み上げ
   * shita: index 0 = 最下段（bottom: 画面下端）から上へ積み上げ
   *
   * 消えたスロット（null）はスキップせず height=0 として扱う
   * → 消えても位置がずれない
   */
  function calcFixedTopY(side, slotIndex, elH) {
    const H     = window.innerHeight;
    const slots = fixedSlots[side];
    let offset  = 0;

    for (let i = 0; i < slotIndex; i++) {
      if (slots[i]) {
        offset += slots[i].height + RECT_MARGIN;
      }
      // null（空きスロット）は height を加算しない
      // → そのスロットを使っていたコメントが消えた後、
      //   後続のコメントは元の位置を維持する
    }

    if (side === "ue") {
      return offset;
    } else {
      // 下固定: 画面下端 - 累積 - この要素の高さ
      return H - offset - elH;
    }
  }

  function renderFixed(payload) {
    const side  = payload.position; // "ue" | "shita"
    const slots = fixedSlots[side];

    // 空きスロット（null）を探す
    let slotIndex = slots.findIndex((s) => s === null);
    if (slotIndex === -1) {
      // 空きなし → 末尾に追加
      slotIndex = slots.length < FIXED_MAX_SLOTS ? slots.length : 0;
      if (slotIndex === 0) {
        // 上限に達したら最古を強制削除
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
    el.appendChild(buildParts(payload, true));
    applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

    stage.appendChild(el);

    // レイアウト確定後に高さを取得してY座標を計算
    requestAnimationFrame(() => {
      const elH  = el.offsetHeight || vhToPx(SIZE_CONFIG[payload.size ?? "medium"].vh) * 1.4;
      const topY = calcFixedTopY(side, slotIndex, elH);

      el.style.top        = `${topY}px`;
      el.style.visibility = "visible";

      const entry = { el, height: elH, topY, timerId: null };
      slots[slotIndex] = entry;

      // 5秒後に即時削除（詰めない）
      entry.timerId = setTimeout(() => {
        el.remove();
        slots[slotIndex] = null;
      }, FIXED_DISPLAY_MS);
    });
  }

})();