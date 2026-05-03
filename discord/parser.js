import { StickerFormatType } from "discord.js";

// ─────────────────────────────────────────────
// グローバル定数
// g フラグなし・または while ループ専用のもののみここに置く
// ─────────────────────────────────────────────

/**
 * カスタム絵文字: while ループで使うため g フラグ必須
 * 使用前後に必ず lastIndex = 0 をリセットする
 */
const RE_ANY_EMOJI = /<(a?):([^:]+):(\d+)>/g;

/**
 * Discord 見出し: g フラグなし・exec() 1回のみ使用するため安全
 */
const RE_HEADING = /^(-#|#{1,3})\s*/;

// ─────────────────────────────────────────────
// マップ
// ─────────────────────────────────────────────

const NAMED_COLORS = {
  white:  "#FFFFFF",
  red:    "#FF4040",
  pink:   "#FF80C0",
  yellow: "#FFE133",
  orange: "#FF9933",
  green:  "#33DD44",
  cyan:   "#33DDFF",
  blue:   "#4488FF",
  purple: "#AA44FF",
  black:  "#111111",
};

const HEADING_SIZE_MAP = {
  "#":   "big",
  "##":  "medium",
  "###": "medium",
  "-#":  "small",
};

const SESSION_EFFECTS = new Set(["gaming", "reverse", "loop"]);
const MSG_COMMANDS    = new Set(["invisible", "_live"]);

// ─────────────────────────────────────────────
// V2 メタブロックパーサー
// ─────────────────────────────────────────────

/**
 * テキスト内の ?attr1 attr2? を全て抽出・除去して
 * color / size / position / sessionFx / msgCommands を返す
 *
 * ★ 正規表現を関数内で毎回生成することで
 *    g フラグの lastIndex 持続問題を完全回避する
 *    → Windows/Debian/Node バージョン差による再現性の差をなくす
 */
function parseMetaBlock(raw) {
  let color       = null;
  let size        = null;
  let position    = null;
  const sessionFx   = [];
  const msgCommands = [];

  // ★ 毎回新しいオブジェクトを生成 → lastIndex は常に 0 から始まる
  const cleaned = raw.replace(/\?([^?]+)\?/g, (_, attrsRaw) => {
    const attrs = attrsRaw.trim().toLowerCase().split(/\s+/);

    for (const attr of attrs) {
      // カラー named
      if (NAMED_COLORS[attr] !== undefined) {
        color = NAMED_COLORS[attr];
        continue;
      }
      // カラー HEX
      if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(attr)) {
        color = attr;
        continue;
      }
      // サイズ
      if (attr === "big" || attr === "medium" || attr === "small") {
        size = attr;
        continue;
      }
      // 位置
      if (attr === "ue") {
        position = "ue";
        continue;
      }
      if (attr === "shita") {
        position = "shita";
        continue;
      }
      // セッションエフェクト
      if (SESSION_EFFECTS.has(attr)) {
        sessionFx.push(attr);
        continue;
      }
      // メッセージ単位コマンド
      // _live は全角スペース先頭でも来る可能性がある
      const normalized = attr.replace(/^\u3000/, "_live");
      if (MSG_COMMANDS.has(normalized)) {
        msgCommands.push(normalized);
        continue;
      }
      if (MSG_COMMANDS.has(attr)) {
        msgCommands.push(attr);
      }
    }

    return ""; // ブロック自体を除去
  });

  return {
    color,
    size,
    position,
    sessionFx,
    msgCommands,
    cleaned: cleaned.trim(),
  };
}

// ─────────────────────────────────────────────
// 見出しからサイズ推測
// ─────────────────────────────────────────────

function extractHeadingSize(text) {
  const m = RE_HEADING.exec(text);
  if (!m) return { size: null, cleaned: text };
  return {
    size:    HEADING_SIZE_MAP[m[1]] ?? null,
    cleaned: text.slice(m[0].length).trimStart(),
  };
}

// ─────────────────────────────────────────────
// インライン書式
// ─────────────────────────────────────────────

/**
 * ★ 全ての正規表現を関数内ローカルで生成
 *    グローバル g フラグ付き正規表現の lastIndex 持続問題を完全回避
 *    動作は元コードと完全に同一
 */
function extractInlineStyles(text) {
  let bold = false, italic = false, underline = false, strikethrough = false;

  // 取り消し線
  if (/~~(.+?)~~/gs.test(text)) {
    strikethrough = true;
    text = text.replace(/~~(.+?)~~/gs, "$1");
  }

  // 下線（太字より先に処理）
  if (/__(.+?)__/gs.test(text)) {
    underline = true;
    text = text.replace(/__(.+?)__/gs, "$1");
  }

  // 太字
  if (/\*\*(.+?)\*\*/gs.test(text)) {
    bold = true;
    text = text.replace(/\*\*(.+?)\*\*/gs, "$1");
  }

  // 斜体
  if (/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs.test(text)) {
    italic = true;
    text   = text.replace(
      /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs,
      (_, g1, g2) => g1 ?? g2 ?? "",
    );
  }

  return { bold, italic, underline, strikethrough, cleaned: text };
}

// ─────────────────────────────────────────────
// テキストセグメント分割
// ─────────────────────────────────────────────

function parseTextSegments(text) {
  const parts = [];
  let lastIndex = 0;
  let match;

  // while ループで使う RE_ANY_EMOJI のみグローバル定数を再利用
  // 使用前後に lastIndex をリセットして安全を担保
  RE_ANY_EMOJI.lastIndex = 0;

  while ((match = RE_ANY_EMOJI.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const seg = text.slice(lastIndex, match.index);
      if (seg) parts.push({ type: "text", content: seg });
    }
    const animated = match[1] === "a";
    const id       = match[3];
    parts.push({
      type:    "emoji",
      content: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=64`,
    });
    lastIndex = RE_ANY_EMOJI.lastIndex;
  }

  RE_ANY_EMOJI.lastIndex = 0; // 使用後もリセット

  if (lastIndex < text.length) {
    const seg = text.slice(lastIndex);
    if (seg) parts.push({ type: "text", content: seg });
  }

  return parts;
}

// ─────────────────────────────────────────────
// スタンプ
// ─────────────────────────────────────────────

function parseStickerParts(stickers) {
  const parts = [];
  for (const sticker of stickers.values()) {
    let format = "png";
    let ext = "png";
    if (sticker.format === StickerFormatType.APNG) {
      format = "apng";
      ext = "png";
    } else if (sticker.format === StickerFormatType.GIF) {
      format = "gif";
      ext = "gif";
    } else if (sticker.format === StickerFormatType.Lottie) {
      format = "lottie";
      ext = "json";
    }

    parts.push({
      type:         "sticker",
      stickerId:    sticker.id,
      stickerFormat: format,
      content:      `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}?size=320`,
    });
  }
  return parts;
}

// ─────────────────────────────────────────────
// 文字数カウント
// ─────────────────────────────────────────────

export function countChars(parts) {
  let currentLine = 0;
  let maxLine = 0;

  const flushLine = () => {
    if (currentLine > maxLine) maxLine = currentLine;
  };

  for (const part of parts) {
    if (part.type === "text") {
      const segments = part.content.split("\n");
      for (let i = 0; i < segments.length; i++) {
        currentLine += [...segments[i]].length;
        if (i < segments.length - 1) {
          flushLine();
          currentLine = 0;
        }
      }
      continue;
    }
    if (part.type === "emoji") {
      currentLine += 1;
      continue;
    }
    if (part.type === "sticker") {
      currentLine += 1;
    }
  }

  flushLine();
  return maxLine;
}

// ─────────────────────────────────────────────
// メインパーサー
// ─────────────────────────────────────────────

export function parseMessage(message, watchChannelIds) {
  if (message.author.bot) return null;
  if (watchChannelIds) {
    const ok = typeof watchChannelIds.has === "function"
      ? watchChannelIds.has(message.channelId)
      : Array.isArray(watchChannelIds)
        ? watchChannelIds.includes(message.channelId)
        : false;
    if (!ok) return null;
  } else {
    return null;
  }

  // ── スタンプ専用 ──────────────────────────────
  if (message.stickers.size > 0) {
    const parts = parseStickerParts(message.stickers);
    if (parts.length === 0) return null;
    return {
      t:           message.createdTimestamp,
      a:           message.member?.displayName ?? message.author.username,
      av:          message.author.displayAvatarURL({ size: 64, extension: "webp" }),
      color:       null,
      size:        "medium",
      position:    null,
      sessionFx:   [],
      msgCommands: [],
      styles:      { bold: false, italic: false, underline: false, strikethrough: false },
      p:           parts,
      charCount:   countChars(parts),
    };
  }

  // ── テキストメッセージ ────────────────────────
  const rawContent = message.content;
  if (!rawContent.trim()) return null;

  // ① メタブロック解析（? ? の位置不問）
  const {
    color,
    size:        metaSize,
    position,
    sessionFx,
    msgCommands,
    cleaned:     afterMeta,
  } = parseMetaBlock(rawContent);

  // ② メタ指定がなければ Discord 見出しからサイズ推測
  let size         = metaSize;
  let afterHeading = afterMeta;
  if (!size) {
    const h  = extractHeadingSize(afterMeta);
    size         = h.size ?? "medium"; // デフォルトは "medium"（null にしない）
    afterHeading = h.cleaned;
  }

  // ③ インライン書式
  const {
    bold, italic, underline, strikethrough,
    cleaned: afterStyles,
  } = extractInlineStyles(afterHeading);

  // ④ テキスト分割
  const parts = parseTextSegments(afterStyles);
  if (parts.length === 0) return null;

  return {
    t:           message.createdTimestamp,
    a:           message.member?.displayName ?? message.author.username,
    av:          message.author.displayAvatarURL({ size: 64, extension: "webp" }),
    color,
    size,        // "big" | "medium" | "small" のいずれか（null にならない）
    position,    // "ue" | "shita" | null
    sessionFx,
    msgCommands,
    styles:      { bold, italic, underline, strikethrough },
    p:           parts,
    charCount:   countChars(parts),
  };
}
