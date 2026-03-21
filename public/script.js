(() => {
  "use strict";

  // ── 設定 ────────────────────────────────────────
  let MAX_FLOW_COMMENTS = 30;
  const FIXED_DISPLAY_MS = 5000;  // 固定表示: 5秒

  // 速度: 画面幅 / DIVISOR = px/秒
  const SPEED_DIVISOR_MIN = 2.5;  // 短文（速い）
  const SPEED_DIVISOR_MAX = 5.0;  // 長文（遅い）
  const CHAR_THRESHOLD    = 30;

  /*
   * サイズ定義（vh単位）
   * 絵文字はテキストと同じ高さに合わせる
   */
  const SIZE_VH = { big: 12, medium: 6, small: 3 };

  /*
   * セッション内エフェクトフラグ
   * /secret コマンドで on/off 制御される
   */
  const sessionEffects = new Set();

  // 衝突判定用矩形リスト
  const activeRects  = [];
  const RECT_MARGIN  = 4; // px: 上下マージン

  let aesKey    = null;
  let flowCount = 0;

  /*
   * 固定スロット管理
   * ue[0]    = 上端に最も近い行
   * shita[0] = 下端に最も近い行
   * スロット数は無制限（画面に収まる範囲で動的計算）
   */
  const fixedSlots = { ue: [], shita: [] };

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

  // /secret コマンドによるセッションエフェクト制御
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

      // セッションエフェクトをペイロードから更新
      if (p.sessionFx?.length > 0) {
        for (const fx of p.sessionFx) sessionEffects.add(fx);
      }

      // invisible コマンド: 描画しない
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
    fixedSlots.ue    = [];
    fixedSlots.shita = [];
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

  // ── サイズ vh を px に変換 ────────────────────────
  function vhToPx(vh) {
    return window.innerHeight * vh / 100;
  }

  // ── パーツ要素生成 ────────────────────────────────
  /**
   * @param {object} payload
   * @param {boolean} forFixed - 固定表示用（align-items: center）
   */
  function buildParts(payload, forFixed = false) {
    const size   = payload.size ?? "medium";
    const sizeVh = SIZE_VH[size] ?? SIZE_VH.medium;
    const sizePx = vhToPx(sizeVh);

    // 絵文字高さ = テキストと同じ（サイズ連動）
    const emojiPx = sizePx;

    const deco = [];
    if (payload.styles?.underline)     deco.push("underline");
    if (payload.styles?.strikethrough) deco.push("line-through");

    const hasGaming = payload.sessionFx?.includes("gaming") || sessionEffects.has("gaming");

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
          if (payload.styles?.italic)      span.style.fontStyle      = "italic";
          if (deco.length > 0)             span.style.textDecoration = deco.join(" ");

          row.appendChild(span);

        } else if (part.type === "emoji") {
          const img           = document.createElement("img");
          img.className       = "emoji";
          img.src             = part.content;
          img.alt             = "";
          img.loading         = "lazy";
          img.style.height    = `${emojiPx}px`;
          img.style.width     = "auto";
          img.style.verticalAlign = "middle";
          row.appendChild(img);

        } else if (part.type === "sticker") {
          // スタンプはサイズの2倍
          const img           = document.createElement("img");
          img.className       = "sticker";
          img.src             = part.content;
          img.alt             = "";
          img.loading         = "lazy";
          img.style.height    = `${sizePx * 2}px`;
          img.style.width     = "auto";
          img.style.verticalAlign = "middle";
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

    // セッションエフェクト
    if (allSession.has("gaming"))  el.classList.add("effect-gaming");
    if (allSession.has("loop"))    el.classList.add("effect-loop");

    // reverse はJS で transform を制御（CSSクラスなし）

    // メッセージ単位コマンド
    if (msgCommands?.includes("_live")) el.classList.add("effect-live");

    // ender: 改行リサイズ無効（white-space: nowrap を強制）
    if (msgCommands?.includes("ender")) {
      el.querySelectorAll(".text-part").forEach((s) => {
        s.style.whiteSpace = "nowrap";
      });
    }
  }

  // ── 衝突判定: 空きY座標を探す ────────────────────
  function findFreeY(elH, minY, maxY) {
    const now = performance.now();
    // 期限切れ矩形を削除
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
        const overlapTop    = Math.max(y      - RECT_MARGIN, rect.top    - RECT_MARGIN);
        const overlapBottom = Math.min(bottom + RECT_MARGIN, rect.bottom + RECT_MARGIN);
        if (overlapBottom > overlapTop) {
          collide = true;
          minGap  = Math.min(minGap, overlapBottom - overlapTop);
        }
      }

      if (!collide) return y;

      const score = -minGap;
      if (score > bestScore) { bestScore = score; bestY = y; }
    }

    // 全て衝突の場合、上端が見切れないことを優先
    return Math.max(minY, Math.min(bestY, safeMax));
  }

  // ── 流れるコメント ────────────────────────────────
  function renderFlow(payload) {
    if (flowCount >= MAX_FLOW_COMMENTS) return;

    const size   = payload.size ?? "medium";
    const sizeVh = SIZE_VH[size] ?? SIZE_VH.medium;

    const el           = document.createElement("div");
    el.className       = "comment";
    el.style.animation = "none";
    el.style.visibility = "hidden";
    el.appendChild(buildParts(payload, false));

    // reverse はページに追加前に left 位置を調整
    const hasReverse = payload.sessionFx?.includes("reverse") || sessionEffects.has("reverse");

    stage.appendChild(el);
    flowCount++;

    requestAnimationFrame(() => {
      const W      = window.innerWidth;
      const H      = window.innerHeight;
      const elW    = el.offsetWidth;
      const elH    = el.offsetHeight;

      // Y座標: 流れコメントはフリー帯域全体（衝突判定つき）
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
        // 左端外側からスタートして右へ
        el.style.left      = `-${elW}px`;
        el.style.animation = `flow ${duration}s linear forwards`;
        el.style.transform = `scaleX(-1) translateX(-${distance}px)`;
        // reverse 用に別アニメーションを適用
        el.style.animation = "none";
        el.style.left      = `-${elW}px`;
        el.animate(
          [
            { transform: "translateX(0)" },
            { transform: `translateX(${distance}px)` },
          ],
          { duration: duration * 1000, easing: "linear", fill: "forwards" },
        ).onfinish = () => { el.remove(); flowCount--; };
      } else {
        el.style.left      = "100vw";
        el.style.animation = `flow ${duration}s linear forwards`;
        el.addEventListener("animationend", () => {
          el.remove();
          flowCount--;
        }, { once: true });
      }

      el.style.visibility = "visible";

      // loop エフェクト上書き
      const hasLoop = payload.sessionFx?.includes("loop") || sessionEffects.has("loop");
      if (hasLoop) {
        el.style.animation = `flow-loop ${duration}s linear infinite`;
        // loop は animationend が来ないため別途タイマーで管理しない
        // （セッション切断時に stage.innerHTML をクリアする想定）
      }

      applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

      // 矩形を登録
      activeRects.push({
        top:    topY,
        bottom: topY + elH,
        expire: performance.now() + duration * 1000 + 500,
      });

      console.log(
        `[overlay] flow size=${size}(${vhToPx(sizeVh).toFixed(0)}px)`,
        `elW=${elW}px elH=${elH}px top=${topY.toFixed(0)}px`,
        `dur=${duration.toFixed(2)}s`,
      );
    });
  }

  // ── 固定コメント ──────────────────────────────────
  /**
   * 固定コメントのY座標を計算する
   * スロットは動的に積み上げる（上固定は上から、下固定は下から）
   * 大きい文字も含めて要素高さをベースに計算する
   *
   * @param {"ue"|"shita"} side
   * @param {HTMLElement} el
   * @returns {number} topY (px)
   */
  function calcFixedTopY(side, el) {
    const H    = window.innerHeight;
    const elH  = el.offsetHeight || vhToPx(SIZE_VH.big) * 1.4; // 未確定時の概算

    // 既存スロットの累積高さを計算
    const slots     = fixedSlots[side];
    const totalUsed = slots.reduce((sum, s) => sum + s.height + RECT_MARGIN, 0);

    if (side === "ue") {
      // 上固定: 上から積み上げ
      return totalUsed;
    } else {
      // 下固定: 下から積み上げ
      // 要素の上端 = 画面下端 - 既存累積高さ - この要素の高さ
      return H - totalUsed - elH;
    }
  }

  function renderFixed(payload) {
    const side  = payload.position; // "ue" | "shita"
    const slots = fixedSlots[side];

    const el     = document.createElement("div");
    el.className = "comment-fixed";
    el.style.visibility = "hidden"; // レイアウト確定まで非表示
    el.appendChild(buildParts(payload, true));
    applyEffectClasses(el, payload.msgCommands, payload.sessionFx);

    // 一旦追加して高さを確定
    stage.appendChild(el);

    requestAnimationFrame(() => {
      const elH  = el.offsetHeight;
      const topY = calcFixedTopY(side, el);

      el.style.top        = `${topY}px`;
      el.style.visibility = "visible";

      // スロットに記録
      const slotEntry = { el, height: elH, timerId: null };
      slots.push(slotEntry);

      console.log(
        `[overlay] fixed side=${side} slot=${slots.length - 1}`,
        `top=${topY.toFixed(1)}px elH=${elH}px`,
      );

      // 5秒後に削除
      slotEntry.timerId = setTimeout(() => {
        removeFixedSlot(side, slotEntry);
      }, FIXED_DISPLAY_MS);
    });
  }

  /**
   * 固定スロットを削除し、残りのスロットのY座標を再計算する
   * @param {"ue"|"shita"} side
   * @param {object} targetEntry
   */
  function removeFixedSlot(side, targetEntry) {
    const slots = fixedSlots[side];
    const idx   = slots.indexOf(targetEntry);
    if (idx === -1) return;

    clearTimeout(targetEntry.timerId);
    targetEntry.el.remove();
    slots.splice(idx, 1);

    // 残りスロットのY座標を再計算
    repositionFixedSlots(side);
  }

  /**
   * 固定スロット全体のY座標を再計算して更新する
   * @param {"ue"|"shita"} side
   */
  function repositionFixedSlots(side) {
    const H     = window.innerHeight;
    const slots = fixedSlots[side];
    let offset  = 0;

    for (const entry of slots) {
      const elH = entry.height;
      const topY = side === "ue"
        ? offset
        : H - offset - elH;

      entry.el.style.top = `${topY}px`;
      offset += elH + RECT_MARGIN;
    }
  }

})();