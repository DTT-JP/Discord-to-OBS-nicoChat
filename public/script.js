(() => {
  "use strict";

  // MAX_FLOW_COMMENTS はサーバーから受け取るまでのデフォルト値
  // auth_success で上書きされる
  let MAX_FLOW_COMMENTS = 30;

  const FIXED_DISPLAY_MS  = 8000;
  const FIXED_MAX_ROWS    = 5;
  const ROW_HEIGHT_VH     = 8;

  const SPEED_MIN      = 250;
  const SPEED_MAX      = 600;
  const SPEED_STICKER  = 380;
  const CHAR_THRESHOLD = 30;

  let aesKey    = null;
  let flowCount = 0;

  const fixedSlots = {
    top:    new Array(FIXED_MAX_ROWS).fill(null),
    bottom: new Array(FIXED_MAX_ROWS).fill(null),
  };

  const authScreen      = document.getElementById("auth-screen");
  const authCodeDisplay = document.getElementById("auth-code-display");
  const stage           = document.getElementById("stage");

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

  function calcSpeed(charCount, isSticker) {
    if (isSticker) return SPEED_STICKER;
    const r = Math.min(charCount, CHAR_THRESHOLD) / CHAR_THRESHOLD;
    return SPEED_MIN + (SPEED_MAX - SPEED_MIN) * r;
  }

  // ── Socket イベント ──────────────────────────────

  socket.on("connect", () => {
    console.log("[overlay] 接続確立 id=", socket.id);
    socket.emit("client_ready");
  });

  if (socket.connected) {
    console.log("[overlay] 既接続 → client_ready 即時送信");
    socket.emit("client_ready");
  }

  socket.on("auth_code", ({ code }) => {
    console.log("[overlay] 認証コード受信:", code);
    authCodeDisplay.textContent = String(code);
  });

  // 認証成功：AES鍵と同時表示上限を受け取る
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

  // 上限のリアルタイム更新
  socket.on("update_limit", ({ maxComments }) => {
    MAX_FLOW_COMMENTS = maxComments;
    console.log(`[overlay] 表示上限を更新: ${maxComments}`);
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
        `| pos:${p.position ?? "flow"}`,
        `| heading:${p.heading ?? "-"}`,
        `| styles:`, p.styles,
        `| chars:${p.charCount}`,
      );

      if (p.position === "top" || p.position === "bottom") {
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
    aesKey                      = null;
    authCodeDisplay.textContent = "------";
    authCodeDisplay.style.color = "#57f287";
    authScreen.style.display    = "flex";
  });

  socket.on("connect_error", (e) => {
    console.error("[overlay] 接続エラー:", e.message);
    setTimeout(() => {
      if (socket.connected) socket.emit("request_code");
    }, 1000);
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

  // ── パーツ要素生成（改行・AA対応） ────────────────
  function buildParts(payload) {
    const deco = [];
    if (payload.styles?.underline)     deco.push("underline");
    if (payload.styles?.strikethrough) deco.push("line-through");

    const lines = [[]];
    for (const part of payload.p) {
      if (part.type === "text") {
        const segments = part.content.split("\n");
        segments.forEach((seg, i) => {
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
      row.style.gap        = "0.2em";
      row.style.minHeight  = "1.4em";

      for (const part of line) {
        if (part.type === "text") {
          const span            = document.createElement("span");
          span.className        = "text-part";
          if (payload.heading)  span.classList.add(`h-${payload.heading}`);
          span.style.whiteSpace = "pre";
          span.textContent      = part.content;
          if (payload.color)           span.style.color          = payload.color;
          if (payload.styles?.bold)    span.style.fontWeight     = "bold";
          if (payload.styles?.italic)  span.style.fontStyle      = "italic";
          if (deco.length > 0)         span.style.textDecoration = deco.join(" ");
          row.appendChild(span);
        } else if (part.type === "emoji") {
          const img     = document.createElement("img");
          img.className = "emoji";
          img.src       = part.content;
          img.alt       = "";
          img.loading   = "lazy";
          row.appendChild(img);
        } else if (part.type === "sticker") {
          const img     = document.createElement("img");
          img.className = "sticker";
          img.src       = part.content;
          img.alt       = "";
          img.loading   = "lazy";
          row.appendChild(img);
        }
      }
      frag.appendChild(row);
    }
    return frag;
  }

  // ── 流れるコメント ────────────────────────────────
  function renderFlow(payload) {
    if (flowCount >= MAX_FLOW_COMMENTS) return;   // ← 可変参照

    const isSticker = payload.p.every((p) => p.type === "sticker");
    const el        = document.createElement("div");
    el.className       = "comment";
    el.style.animation = "none";
    el.appendChild(buildParts(payload));

    const H    = window.innerHeight;
    const minY = H * 0.02;
    const maxY = H * 0.94;
    el.style.top = `${Math.floor(Math.random() * (maxY - minY) + minY)}px`;

    stage.appendChild(el);
    flowCount++;

    requestAnimationFrame(() => {
      const W        = window.innerWidth;
      const elW      = el.offsetWidth;
      const distance = W + elW;
      const speed    = calcSpeed(payload.charCount ?? 10, isSticker);
      const duration = distance / speed;

      el.style.setProperty("--distance", `${distance}px`);
      el.style.setProperty("--duration",  `${duration}s`);
      el.style.animation = "";

      console.log(
        `[overlay] flow elW=${elW}px dist=${distance}px`,
        `spd=${speed.toFixed(0)}px/s dur=${duration.toFixed(2)}s`,
      );
    });

    el.addEventListener("animationend", () => {
      el.remove();
      flowCount--;
    }, { once: true });
  }

  // ── 固定コメント ──────────────────────────────────
  function renderFixed(payload) {
    const side  = payload.position;
    const slots = fixedSlots[side];

    let idx = slots.findIndex((s) => s === null);
    if (idx === -1) {
      forceRemoveSlot(side, 0);
      idx = 0;
    }

    const el     = document.createElement("div");
    el.className = "comment-fixed";
    el.appendChild(buildParts(payload));

    const H     = window.innerHeight;
    const rowPx = H * ROW_HEIGHT_VH / 100;
    const topPx = side === "top"
      ? idx * rowPx
      : H - (idx + 1) * rowPx;

    el.style.top = `${topPx}px`;
    stage.appendChild(el);
    slots[idx] = el;

    console.log(`[overlay] fixed side=${side} slot=${idx} top=${topPx.toFixed(1)}px`);

    const timerId = setTimeout(() => instantRemoveSlot(side, idx), FIXED_DISPLAY_MS);
    el._timerId   = timerId;
  }

  function instantRemoveSlot(side, idx) {
    const el = fixedSlots[side][idx];
    if (!el) return;
    el.remove();
    fixedSlots[side][idx] = null;
  }

  function forceRemoveSlot(side, idx) {
    const el = fixedSlots[side][idx];
    if (!el) return;
    clearTimeout(el._timerId);
    el.remove();
    fixedSlots[side][idx] = null;
  }

})();