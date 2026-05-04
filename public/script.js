(() => {
  "use strict";

  // ────────────────────────────────────────────────
  // 設定
  // ────────────────────────────────────────────────

  let MAX_FLOW_COMMENTS = 30;       // auth_success で上書き
  const FIXED_DISPLAY_MS  = 4000;  // 上下固定の表示時間（ms）

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
  // 画面サイズ取得
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

  const RESUME_STORAGE_KEY = "d2obs_resume_v1";
  const UUID_RE =
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$/;
  const RESUME_RE = /^[0-9a-fA-F]{64}$/;

  const urlToken = new URLSearchParams(location.search).get("token");
  let resumeStored = null;
  try {
    resumeStored = sessionStorage.getItem(RESUME_STORAGE_KEY);
  } catch (_) { /* ストレージ不可 */ }

  const socketQuery = (urlToken && UUID_RE.test(urlToken))
    ? { token: urlToken }
    : (resumeStored && RESUME_RE.test(resumeStored) ? { resume: resumeStored } : {});

  const socket = io({ query: socketQuery });

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
    console.log("[overlay] 認証コードを表示しました（ログには値を出しません）");
  });

  socket.on("auth_success", async ({ key, maxComments, resumeToken }) => {
    try {
      aesKey            = await importKey(key);
      MAX_FLOW_COMMENTS = maxComments;

      if (typeof resumeToken === "string" && RESUME_RE.test(resumeToken)) {
        try {
          sessionStorage.setItem(RESUME_STORAGE_KEY, resumeToken);
        } catch (_) { /* ignore */ }
      }

      // ── 認証コードをDOMから完全に削除 ──────────
      // トークンがURLに残るため、認証後は画面上から
      // コードを残さないようにテキストと要素をクリアする
      authCodeDisplay.textContent = "";
      const codeLabel = authScreen.querySelector("h1");
      if (codeLabel) codeLabel.remove();
      const codeDesc = authScreen.querySelector("p");
      if (codeDesc) codeDesc.remove();
      // authCodeDisplay 自体も空にして非表示
      authCodeDisplay.style.display = "none";

      authScreen.style.display = "none";

      // 認証完了後は URL からトークンクエリを取り除く（履歴・共有時の露出軽減）
      try {
        const path = location.pathname || "/";
        const next = `${path}${location.hash || ""}`;
        if (location.search) history.replaceState(null, "", next);
      } catch (_) { /* ignore */ }

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
    // 切断時: 認証コード表示をリセットして認証画面を再表示
    authCodeDisplay.textContent  = "------";
    authCodeDisplay.style.color  = "#57f287";
    authCodeDisplay.style.display = "";
    authScreen.style.display     = "flex";
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

  function buildParts(payload, forFixed = false) {
    const sizeKey = (payload.size && SIZE_CONFIG[payload.size])
      ? payload.size
      : "medium";

    const sizePx    = vhToPx(SIZE_CONFIG[sizeKey].vh);
    const emojiPx   = sizePx;
    const stickerPx = sizePx;

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

          if (!hasGaming) {
            const color = payload.color || "#ffffff";
            span.style.setProperty("color", color, "important");
          }

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
          if (part.stickerFormat === "lottie" && window.bodymovin) {
            const lottie = document.createElement("span");
            lottie.className = "sticker sticker-lottie";
            lottie.style.height = `${stickerPx}px`;
            lottie.style.width = `${stickerPx}px`;
            lottie.style.display = "inline-block";
            lottie.style.verticalAlign = "middle";
            row.appendChild(lottie);

            requestAnimationFrame(() => {
              window.bodymovin.loadAnimation({
                container: lottie,
                renderer: "svg",
                loop: true,
                autoplay: true,
                path: part.content,
              });
            });
          } else {
            const img               = document.createElement("img");
            img.className           = "sticker";
            img.alt                 = "";
            img.loading             = "lazy";
            img.style.height        = `${stickerPx}px`;
            img.style.width         = "auto";
            img.style.verticalAlign = "middle";
            img.style.display       = "inline-block";
            img.style.fontStyle     = "normal";
            img.style.transform     = "none";

            // クラッシュGIF対策: GIFスタンプは静止プレビューPNGを使う
            if (part.stickerFormat === "gif" && part.stickerId) {
              img.src = `https://media.discordapp.net/stickers/${part.stickerId}.png?size=160`;
            } else {
              img.src = part.content;
            }

            row.appendChild(img);
          }
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

    // 期限切れ矩形を削除
    for (let i = activeRects.length - 1; i >= 0; i--) {
      if (now > activeRects[i].expire) activeRects.splice(i, 1);
    }

    if (maxY <= minY) return minY;

    const range = maxY - minY;

    function overlapAt(y) {
      const bottom = y + elH;
      let maxOverlap = 0;
      for (const r of activeRects) {
        const ot = Math.max(y - RECT_MARGIN,      r.top    - RECT_MARGIN);
        const ob = Math.min(bottom + RECT_MARGIN, r.bottom + RECT_MARGIN);
        if (ob > ot) maxOverlap = Math.max(maxOverlap, ob - ot);
      }
      return maxOverlap;
    }

    let bestY     = Math.floor(Math.random() * (range + 1)) + minY;
    let bestScore = Infinity;

    for (let i = 0; i < 20; i++) {
      const candidate = Math.floor(Math.random() * (range + 1)) + minY;
      const overlap   = overlapAt(candidate);

      if (overlap === 0) return candidate;

      if (overlap < bestScore) {
        bestScore = overlap;
        bestY     = candidate;
      }
    }

    return Math.min(bestY, maxY);
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
      const rawH     = el.offsetHeight || vhToPx(SIZE_CONFIG[payload.size ?? "medium"].vh) * 1.4;
      const elH      = applyVerticalFitScale(el, "ue", rawH);

      const minY = 0;
      const maxY = Math.max(0, H - elH);
      const topY = elH >= H ? 0 : findFreeY(elH, minY, maxY);

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

  function calcFixedPosition(side, slotIndex, elH) {
    const slots = fixedSlots[side];
    let offset  = 0;

    for (let i = 0; i < slotIndex; i++) {
      if (slots[i]) {
        offset += slots[i].height + RECT_MARGIN;
      }
    }

    if (side === "ue") {
      return { prop: "top",    value: offset };
    } else {
      return { prop: "bottom", value: offset };
    }
  }


  function getAdaptiveScaleForFixed(elH) {
    const { H } = getScreenSize();
    if (elH <= 0 || H <= 0) return 1;
    return Math.min(1, H / elH);
  }

  function applyVerticalFitScale(el, side, rawH) {
    const scale = getAdaptiveScaleForFixed(rawH);
    if (scale < 1) {
      el.style.transformOrigin = side === "shita" ? "bottom center" : "top center";
      el.style.transform = `scale(${scale})`;
      return rawH * scale;
    }
    return rawH;
  }

  function renderFixed(payload) {
    const side  = payload.position;
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

    if (side === "shita") {
      el.style.top    = "auto";
      el.style.bottom = "0px";
    }

    el.appendChild(buildParts(payload, true));
    applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

    stage.appendChild(el);

    requestAnimationFrame(() => {
      const { H } = getScreenSize();
      const rawH = el.offsetHeight || vhToPx(SIZE_CONFIG[payload.size ?? "medium"].vh) * 1.4;
      let effectiveH = rawH;
      let pos = calcFixedPosition(side, slotIndex, effectiveH);

      const wouldOverflowRemaining = pos.value + effectiveH > H;
      if (wouldOverflowRemaining) {
        if (side === "ue") {
          pos = { prop: "top", value: 0 };
        } else {
          pos = { prop: "bottom", value: 0 };
        }
      }

      const wouldOverflowWholeScreen = pos.value + effectiveH > H;
      if (wouldOverflowWholeScreen) {
        effectiveH = applyVerticalFitScale(el, side, rawH);
        pos = side === "ue"
          ? { prop: "top", value: 0 }
          : { prop: "bottom", value: 0 };
      }

      if (pos.prop === "top") {
        el.style.top    = `${pos.value}px`;
        el.style.bottom = "auto";
      } else {
        el.style.bottom = `${pos.value}px`;
        el.style.top    = "auto";
      }

      el.style.visibility = "visible";

      const entry = { el, height: effectiveH, timerId: null };
      slots[slotIndex] = entry;

      entry.timerId = setTimeout(() => {
        el.remove();
        slots[slotIndex] = null;
      }, FIXED_DISPLAY_MS);
    });
  }

})();
