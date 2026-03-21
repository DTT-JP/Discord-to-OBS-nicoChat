import { StickerFormatType } from "discord.js";

// ─────────────────────────────────────────────
// 定数
// ─────────────────────────────────────────────

/** V2 メタデータブロック: ?attr1 attr2? （位置不問） */
const RE_META_BLOCK = /\?([^?]+)\?\s*/g;

const RE_ANY_EMOJI     = /<(a?):([^:]+):(\d+)>/g;
const RE_HEADING       = /^(-#|#{1,3})\s*/;
const RE_BOLD          = /\*\*(.+?)\*\*/gs;
const RE_ITALIC        = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs;
const RE_UNDERLINE     = /__(.+?)__/gs;
const RE_STRIKETHROUGH = /~~(.+?)~~/gs;

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

/** セッションエフェクト（/secret コマンド用） */
const SESSION_EFFECTS = new Set(["gaming", "reverse", "loop"]);

/**
 * メッセージ単位の隠しコマンド
 * invisible と _live のみ残す
 */
const MSG_COMMANDS = new Set([
  "invisible",  // コメントを非表示
  "_live",      // 半透過
]);

// ─────────────────────────────────────────────
// V2 メタブロックパーサー
// ─────────────────────────────────────────────

function parseMetaBlock(raw) {
  let color       = null;
  let size        = null;
  let position    = null;
  const sessionFx   = [];
  const msgCommands = [];

  const cleaned = raw.replace(RE_META_BLOCK, (_, attrsRaw) => {
    const attrs = attrsRaw.trim().toLowerCase().split(/\s+/);

    for (const attr of attrs) {
      if (NAMED_COLORS[attr] !== undefined) { color = NAMED_COLORS[attr]; continue; }
      if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(attr)) { color = attr; continue; }
      if (attr === "big" || attr === "medium" || attr === "small") { size = attr; continue; }
      if (attr === "ue")    { position = "ue";    continue; }
      if (attr === "shita") { position = "shita"; continue; }
      if (SESSION_EFFECTS.has(attr)) { sessionFx.push(attr); continue; }
      // _live は先頭全角スペース付きでも来る可能性がある
      const normalized = attr.startsWith("\u3000") ? "_live" : attr;
      if (MSG_COMMANDS.has(normalized)) msgCommands.push(normalized);
      else if (MSG_COMMANDS.has(attr))  msgCommands.push(attr);
    }
    return "";
  });

  RE_META_BLOCK.lastIndex = 0;
  return { color, size, position, sessionFx, msgCommands, cleaned: cleaned.trim() };
}

// ─────────────────────────────────────────────
// 見出しからサイズ推測
// ─────────────────────────────────────────────

function extractHeadingSize(text) {
  const m = RE_HEADING.exec(text);
  if (!m) return { size: null, cleaned: text };
  return { size: HEADING_SIZE_MAP[m[1]] ?? null, cleaned: text.slice(m[0].length).trimStart() };
}

// ─────────────────────────────────────────────
// インライン書式
// ─────────────────────────────────────────────

function extractInlineStyles(text) {
  let bold = false, italic = false, underline = false, strikethrough = false;

  if (RE_STRIKETHROUGH.test(text)) { strikethrough = true; text = text.replace(RE_STRIKETHROUGH, "$1"); RE_STRIKETHROUGH.lastIndex = 0; }
  if (RE_UNDERLINE.test(text))     { underline     = true; text = text.replace(RE_UNDERLINE, "$1");     RE_UNDERLINE.lastIndex     = 0; }
  if (RE_BOLD.test(text))          { bold          = true; text = text.replace(RE_BOLD, "$1");          RE_BOLD.lastIndex          = 0; }
  if (RE_ITALIC.test(text))        { italic        = true; text = text.replace(RE_ITALIC, (_, g1, g2) => g1 ?? g2 ?? ""); RE_ITALIC.lastIndex = 0; }

  return { bold, italic, underline, strikethrough, cleaned: text };
}

// ─────────────────────────────────────────────
// テキストセグメント分割
// ─────────────────────────────────────────────

function parseTextSegments(text) {
  const parts = [];
  let lastIndex = 0;
  let match;
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

  if (lastIndex < text.length) {
    const seg = text.slice(lastIndex);
    if (seg) parts.push({ type: "text", content: seg });
  }
  return parts;
}

// ─────────────────────────────────────────────
// スタンプ（Discordのチャット側には表示されない・OBSのみ）
// ─────────────────────────────────────────────

function parseStickerParts(stickers) {
  const parts = [];
  for (const sticker of stickers.values()) {
    if (sticker.format === StickerFormatType.Lottie) continue;
    const ext = sticker.format === StickerFormatType.GIF ? "gif" : "webp";
    parts.push({
      type:    "sticker",
      content: `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}?size=320`,
    });
  }
  return parts;
}

// ─────────────────────────────────────────────
// 文字数カウント
// ─────────────────────────────────────────────

export function countChars(parts) {
  return parts.reduce((acc, part) => {
    if (part.type === "text")    return acc + [...part.content.replace(/\n/g, "")].length;
    if (part.type === "emoji")   return acc + 1;
    if (part.type === "sticker") return acc + 10;
    return acc;
  }, 0);
}

// ─────────────────────────────────────────────
// メインパーサー
// ─────────────────────────────────────────────

export function parseMessage(message, watchChannelIds) {
  if (message.author.bot) return null;
  if (!watchChannelIds.includes(message.channelId)) return null;

  // スタンプ専用（OBSのみに表示・Discordのチャット側には表示されない）
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

  const rawContent = message.content;
  if (!rawContent.trim()) return null;

  const { color, size: metaSize, position, sessionFx, msgCommands, cleaned: afterMeta } =
    parseMetaBlock(rawContent);

  let size        = metaSize;
  let afterHeading = afterMeta;
  if (!size) {
    const h  = extractHeadingSize(afterMeta);
    size         = h.size ?? "medium";
    afterHeading = h.cleaned;
  }

  const { bold, italic, underline, strikethrough, cleaned: afterStyles } =
    extractInlineStyles(afterHeading);

  const parts = parseTextSegments(afterStyles);
  if (parts.length === 0) return null;

  return {
    t:           message.createdTimestamp,
    a:           message.member?.displayName ?? message.author.username,
    av:          message.author.displayAvatarURL({ size: 64, extension: "webp" }),
    color,
    size,
    position,
    sessionFx,
    msgCommands,
    styles:      { bold, italic, underline, strikethrough },
    p:           parts,
    charCount:   countChars(parts),
  };
}