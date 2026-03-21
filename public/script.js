(() => {
  "use strict";

  // ── 設定 ────────────────────────────────────────
  let MAX_FLOW_COMMENTS = 30;
  const FIXED_DISPLAY_MS = 5000;

  const SPEED_DIVISOR_MIN = 2.5;
  const SPEED_DIVISOR_MAX = 5.0;
  const CHAR_THRESHOLD    = 30;

  const SIZE_VH = { big: 12, medium: 6, small: 3 };

  const sessionEffects = new Set();
  const activeRects    = [];
  const RECT_MARGIN    = 4;

  let aesKey    = null;
  let flowCount = 0;

  /*
   * 固定スロット管理
   * 各スロットは { el, timerId, height, topY } を持つ
   * 消えても詰めず、そのまま空きになる（null）
   * ue[0] = 最上段、shita[0] = 最下段
   */
  const FIXED_MAX_SLOTS = 20; // 上下それぞれの最大スロット数
  const fixedSlots = {
    ue:    new Array(FIXED_MAX_SLOTS).fill(null),
    shita: new Array(FIXED_MAX_SLOTS).fill(null),
  };

  const authScreen      = document.getElementById("auth-screen");
  const authCodeDisplay = document.getElementById("auth-code-display");
  const stage           = document.getElementById("stage");

  // ── Socket.io ────────────────────────────────────
  const token  = new URLSearchParams(location.search).get("token");
  const socket = io({ query: { token } });

  // ── WebCrypto ────────────────────────────────────
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

  // ── 速度計算 ─────────────────────────────────────
  function calcSpeed(charCount) {
    const W       = window.innerWidth;
    const r       = Math.min(charCount, CHAR_THRESHOLD) / CHAR_THRESHOLD;
    const divisor = SPEED_DIVISOR_MIN + (SPEED_DIVISOR_MAX - SPEED_DIVISOR_MIN) * (1 - r);
    return W / divisor;
  }

  function vhToPx(vh) {
    return window.innerHeight * vh / 100;
  }

  // ── Socket イベント ──────────────────────────────
  socket.on("connect", () => {
    console.log("[overlay] 接続 id=", socket.id);
    socket.emit("client_ready");
  });

  if (socket.connected) socket.emit("client_ready");

  socket.on("auth_code", ({ code }) => {
    console.log("[overlay] 認証コード:", code);
    authCodeDisplay.textContent = String(code);
  });

  socket.on("auth_success", async ({ key, maxComments }) => {
    try {
      aesKey            = await importKey(key);
      MAX_FLOW_COMMENTS = maxComments;
      authScreen.style.display = "none";
      console.log(`[overlay] 認証完了 maxComments=${maxComments}`);
    } catch (e) {
      console.error("[overlay] 鍵エラー:", e);
      showAuthError("鍵の設定に失敗しました");
    }
  });

  socket.on("update_limit", ({ maxComments }) => {
    MAX_FLOW_COMMENTS = maxComments;
    console.log(`[overlay] 上限更新: ${maxComments}`);
  });

  socket.on("apply_secret", ({ effect, value }) => {
    if (value) {
      sessionEffects.add(effect);
    } else {
      sessionEffects.delete(effect);
    }
    console.log(`[overlay] apply_secret: ${effect}=${value} 現在:[${[...sessionEffects]}]`);
  });

  socket.on("message", async (enc) => {
    if (!aesKey) return;
    try {
      const p = await decryptPayload(enc, aesKey);

      const text = p.p.map((x) =>
        x.type === "text" ? x.content : `[${x.type}]`
      ).join("").replace(/\n/g, "\\n");

      console.log(
        "[overlay] 受信",
        `| author:${p.a}`,
        `| text:"${text}"`,
        `| color:${p.color ?? "-"}`,
        `| size:${p.size}`,
        `| pos:${p.position ?? "flow"}`,
        `| sessionFx:[${p.sessionFx?.join(",") || "-"}]`,
        `| msgCmds:[${p.msgCommands?.join(",") || "-"}]`,
        `| styles:`, p.styles,
        `| chars:${p.charCount}`,
      );

      // セッションエフェクト更新
      if (p.sessionFx?.length > 0) {
        for (const fx of p.sessionFx) sessionEffects.add(fx);
      }

      // invisible: 描画しない
      if (p.msgCommands?.includes("invisible")) {
        console.log("[overlay] invisible: 描画スキップ");
        return;
      }

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
    console.error(`[overlay] エラー[${code}]:`, message);
    showAuthError(message);
  });

  socket.on("disconnect", (r) => {
    console.warn("[overlay] 切断:", r);
    aesKey = null;
    sessionEffects.clear();
    // 全固定スロットをクリア
    for (const side of ["ue", "shita"]) {
      fixedSlots[side].forEach((slot) => {
        if (slot) {
          clearTimeout(slot.timerId);
          slot.el.remove();
        }
      });
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

  // ── 認証エラー ────────────────────────────────────
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

  // ── パーツ要素生成 ────────────────────────────────
  /**
   * 斜体バグの修正:
   * img要素に font-style: normal を明示して
   * 親要素の italic が img に継承されないようにする
   */
  function buildParts(payload, forFixed = false) {
    const size   = payload.size ?? "medium";
    const sizeVh = SIZE_VH[size] ?? SIZE_VH.medium;
    const sizePx = vhToPx(sizeVh);

    const deco = [];
    if (payload.styles?.underline)     deco.push("underline");
    if (payload.styles?.strikethrough) deco.push("line-through");

    const hasGaming = payload.sessionFx?.includes("gaming") || sessionEffects.has("gaming");
    const isItalic  = payload.styles?.italic ?? false;

    // 行単位に分解
    const lines = [[]];
    for (const part of payload.p) {
      if (part.type === "text") {
        const segs = part.content.split("\n");
        segs.forEach((seg, i) => {
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
      row.style.minHeight  = `${sizePx * 1.3}px`;
      if (forFixed) row.style.justifyContent = "center";

      for (const part of line) {
        if (part.type === "text") {
          const span            = document.createElement("span");
          span.className        = "text-part";
          span.style.fontSize   = `${sizePx}px`;
          span.style.lineHeight = "1.3";
          span.style.whiteSpace = "pre";
          span.textContent      = part.content;

          if (payload.color && !hasGaming) span.style.color = payload.color;
          if (payload.styles?.bold)        span.style.fontWeight     = "bold";
          if (isItalic)                    span.style.fontStyle      = "italic";
          if (deco.length > 0)             span.style.textDecoration = deco.join(" ");

          row.appendChild(span);

        } else if (part.type === "emoji") {
          const img               = document.createElement("img");
          img.className           = "emoji";
          img.src                 = part.content;
          img.alt                 = "";
          img.loading             = "lazy";
          img.style.height        = `${sizePx}px`;   // テキストと同サイズ
          img.style.width         = "auto";
          img.style.verticalAlign = "middle";
          img.style.display       = "inline-block";
          // ★ 斜体継承を明示的にリセット
          img.style.fontStyle     = "normal";
          img.style.transform     = "none";
          row.appendChild(img);

        } else if (part.type === "sticker") {
          const img               = document.createElement("img");
          img.className           = "sticker";
          img.src                 = part.content;
          img.alt                 = "";
          img.loading             = "lazy";
          img.style.height        = `${sizePx * 2}px`;
          img.style.width         = "auto";
          img.style.verticalAlign = "middle";
          img.style.display       = "inline-block";
          // ★ 斜体継承を明示的にリセット
          img.style.fontStyle     = "normal";
          img.style.transform     = "none";
          row.appendChild(img);
        }
      }

      frag.appendChild(row);
    }

    return frag;
  }

  // ── エフェクトクラス付与 ──────────────────────────
  function applyEffectClasses(el, msgCommands, payloadSessionFx) {
    const allSession = new Set([...(payloadSessionFx ?? []), ...sessionEffects]);

    if (allSession.has("gaming")) el.classList.add("effect-gaming");
    if (allSession.has("loop"))   el.classList.add("effect-loop");
    if (msgCommands?.includes("_live")) el.classList.add("effect-live");

    if (msgCommands?.includes("ender")) {
      el.querySelectorAll(".text-part").forEach((s) => {
        s.style.whiteSpace = "nowrap";
      });
    }
  }

  // ── 衝突判定 ─────────────────────────────────────
  function findFreeY(elH, minY, maxY) {
    const now = performance.now();
    for (let i = activeRects.length - 1; i >= 0; i--) {
      if (now > activeRects[i].expire) activeRects.splice(i, 1);
    }

    const safeMax = Math.min(maxY, window.innerHeight - elH);
    const step    = Math.max(2, Math.floor(elH / 4));
    let bestY     = minY;
    let bestScore = -Infinity;

    for (let y = minY; y <= safeMax; y += step) {
      const bottom = y + elH;
      let collide  = false;
      let minGap   = Infinity;

      for (const rect of activeRects) {
        const ot = Math.max(y - RECT_MARGIN, rect.top - RECT_MARGIN);
        const ob = Math.min(bottom + RECT_MARGIN, rect.bottom + RECT_MARGIN);
        if (ob > ot) {
          collide = true;
          minGap  = Math.min(minGap, ob - ot);
        }
      }

      if (!collide) return y;
      const score = -minGap;
      if (score > bestScore) { bestScore = score; bestY = y; }
    }

    return Math.max(minY, Math.min(bestY, safeMax));
  }

  // ── 流れるコメント ────────────────────────────────
  function renderFlow(payload) {
    if (flowCount >= MAX_FLOW_COMMENTS) return;

    const el           = document.createElement("div");
    el.className       = "comment";
    el.style.animation = "none";
    el.style.visibility = "hidden";
    el.appendChild(buildParts(payload, false));

    const hasReverse = payload.sessionFx?.includes("reverse") || sessionEffects.has("reverse");

    stage.appendChild(el);
    flowCount++;

    requestAnimationFrame(() => {
      const W      = window.innerWidth;
      const H      = window.innerHeight;
      const elW    = el.offsetWidth;
      const elH    = el.offsetHeight;

      const minY = H * 0.01;
      const maxY = H * 0.98 - elH;
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
          [
            { transform: "translateX(0)" },
            { transform: `translateX(${distance}px)` },
          ],
          { duration: duration * 1000, easing: "linear", fill: "forwards" },
        );
        anim.onfinish = () => { el.remove(); flowCount--; };
      } else {
        el.style.left      = "100vw";
        el.style.animation = `flow ${duration}s linear forwards`;
        el.addEventListener("animationend", () => {
          el.remove();
          flowCount--;
        }, { once: true });
      }

      el.style.visibility = "visible";

      const hasLoop = payload.sessionFx?.includes("loop") || sessionEffects.has("loop");
      if (hasLoop) {
        el.style.animation = `flow-loop ${duration}s linear infinite`;
      }

      applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

      activeRects.push({
        top:    topY,
        bottom: topY + elH,
        expire: performance.now() + duration * 1000 + 500,
      });

      console.log(
        `[overlay] flow size=${payload.size}(${vhToPx(SIZE_VH[payload.size ?? "medium"]).toFixed(0)}px)`,
        `elW=${elW}px elH=${elH}px top=${topY.toFixed(0)}px dur=${duration.toFixed(2)}s`,
      );
    });
  }

  // ── 固定コメント ──────────────────────────────────
  /**
   * 固定スロットの Y 座標を計算する
   *
   * スロットは配列インデックス順に並ぶ（消えても詰めない）
   * ue:    index 0 が最上段、index が増えるほど下へ
   * shita: index 0 が最下段、index が増えるほど上へ
   *
   * 各スロットの高さは確定後に height として記録する
   * 未確定スロット（null）はスキップして次のスロットへ
   */
  function calcFixedTopY(side, slotIndex, elH) {
    const H     = window.innerHeight;
    const slots = fixedSlots[side];

    if (side === "ue") {
      // 上固定: index 0 から下へ積み上げ
      let offset = 0;
      for (let i = 0; i < slotIndex; i++) {
        if (slots[i]) {
          offset += slots[i].height + RECT_MARGIN;
        } else {
          // 空きスロットは height 0 として扱う（詰めない）
          // 空きは予約済みの高さを保持しない → そのスロットは skip
        }
      }
      return offset;
    } else {
      // 下固定: index 0 から上へ積み上げ
      let offset = 0;
      for (let i = 0; i < slotIndex; i++) {
        if (slots[i]) {
          offset += slots[i].height + RECT_MARGIN;
        }
      }
      // 下固定は画面下端 - offset - この要素の高さ
      return H - offset - elH;
    }
  }

  function renderFixed(payload) {
    const side  = payload.position; // "ue" | "shita"
    const slots = fixedSlots[side];

    // 空きスロットを探す（null のインデックス）
    let slotIndex = slots.findIndex((s) => s === null);

    // 空きがなければ末尾に追加（FIXED_MAX_SLOTS を超えても許容）
    if (slotIndex === -1) {
      slotIndex = slots.length;
      slots.push(null);
    }

    const el     = document.createElement("div");
    el.className = "comment-fixed";
    el.style.visibility = "hidden";
    el.appendChild(buildParts(payload, true));
    applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

    stage.appendChild(el);

    requestAnimationFrame(() => {
      const elH  = el.offsetHeight;
      const topY = calcFixedTopY(side, slotIndex, elH);

      el.style.top        = `${topY}px`;
      el.style.visibility = "visible";

      // スロットに記録
      const entry = {
        el,
        height:  elH,
        topY,
        timerId: null,
      };
      slots[slotIndex] = entry;

      console.log(
        `[overlay] fixed side=${side} slot=${slotIndex}`,
        `top=${topY.toFixed(1)}px elH=${elH}px`,
      );

      // ★ 個別タイマーで5秒後に消去（詰めない）
      entry.timerId = setTimeout(() => {
        el.remove();
        slots[slotIndex] = null; // スロットを空きにする（位置は変えない）
        console.log(`[overlay] fixed expired side=${side} slot=${slotIndex}`);
      }, FIXED_DISPLAY_MS);
    });
  }

})();