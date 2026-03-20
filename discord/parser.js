import { StickerFormatType } from "discord.js";

// ─────────────────────────────────────────────
// 正規表現
// ─────────────────────────────────────────────

const RE_ANY_EMOJI     = /<(a?):([^:]+):(\d+)>/g;
const RE_COMMAND       = /^\[([^\]]+)\]\s*/;
const RE_HEADING       = /^(-#|#{1,3})\s*/;

// s フラグ（dotAll）で改行をまたいだマッチに対応
const RE_BOLD          = /\*\*(.+?)\*\*/gs;
const RE_ITALIC        = /(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)|(?<!_)_(?!_)(.+?)(?<!_)_(?!_)/gs;
const RE_UNDERLINE     = /__(.+?)__/gs;
const RE_STRIKETHROUGH = /~~(.+?)~~/gs;

// ─────────────────────────────────────────────
// マップ
// ─────────────────────────────────────────────

const COLOR_MAP = {
  赤: "#FF4040", red:    "#FF4040",
  青: "#4488FF", blue:   "#4488FF",
  黄: "#FFE133", yellow: "#FFE133",
  緑: "#33DD44", green:  "#33DD44",
  白: "#FFFFFF", white:  "#FFFFFF",
};

const POSITION_MAP = {
  上: "top",    ue:     "top",    top:    "top",
  下: "bottom", sita:   "bottom", bottom: "bottom",
};

const HEADING_MAP = {
  "-#": "hs",
  "#":  "h1",
  "##": "h2",
  "###":"h3",
};

// ─────────────────────────────────────────────
// メタ情報抽出（順不同・完全対応）
// ─────────────────────────────────────────────

function extractMeta(raw) {
  let text     = raw.trimStart();
  let color    = null;
  let position = null;
  let heading  = null;

  let progress = true;
  while (progress) {
    progress = false;

    // 角括弧コマンドの試行
    const cmdMatch = RE_COMMAND.exec(text);
    if (cmdMatch) {
      const key = cmdMatch[1].toLowerCase().trim();
      if (!color    && COLOR_MAP[key]    !== undefined) {
        color    = COLOR_MAP[key];
        text     = text.slice(cmdMatch[0].length);
        progress = true;
        RE_COMMAND.lastIndex = 0;
        continue;
      }
      if (!position && POSITION_MAP[key] !== undefined) {
        position = POSITION_MAP[key];
        text     = text.slice(cmdMatch[0].length);
        progress = true;
        RE_COMMAND.lastIndex = 0;
        continue;
      }
    }
    RE_COMMAND.lastIndex = 0;

    // 見出し記号の試行
    if (!heading) {
      const hMatch = RE_HEADING.exec(text);
      if (hMatch) {
        heading  = HEADING_MAP[hMatch[1]] ?? null;
        text     = text.slice(hMatch[0].length);
        progress = true;
        RE_HEADING.lastIndex = 0;
        continue;
      }
      RE_HEADING.lastIndex = 0;
    }
  }

  return { color, position, heading, cleaned: text.trimStart() };
}

// ─────────────────────────────────────────────
// インライン書式
// ─────────────────────────────────────────────

function extractInlineStyles(text) {
  let bold = false, italic = false, underline = false, strikethrough = false;

  if (RE_STRIKETHROUGH.test(text)) {
    strikethrough = true;
    text = text.replace(RE_STRIKETHROUGH, "$1");
    RE_STRIKETHROUGH.lastIndex = 0;
  }
  if (RE_UNDERLINE.test(text)) {
    underline = true;
    text = text.replace(RE_UNDERLINE, "$1");
    RE_UNDERLINE.lastIndex = 0;
  }
  if (RE_BOLD.test(text)) {
    bold = true;
    text = text.replace(RE_BOLD, "$1");
    RE_BOLD.lastIndex = 0;
  }
  if (RE_ITALIC.test(text)) {
    italic = true;
    text   = text.replace(RE_ITALIC, (_, g1, g2) => g1 ?? g2 ?? "");
    RE_ITALIC.lastIndex = 0;
  }

  return { bold, italic, underline, strikethrough, cleaned: text };
}

// ─────────────────────────────────────────────
// テキストセグメント
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
// スタンプ
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
// 文字数カウント（改行は0文字扱い）
// ─────────────────────────────────────────────

export function countChars(parts) {
  return parts.reduce((acc, part) => {
    if (part.type === "text") {
      // 改行を除いた実文字数をカウント
      return acc + [...part.content.replace(/\n/g, "")].length;
    }
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

  if (message.stickers.size > 0) {
    const parts = parseStickerParts(message.stickers);
    if (parts.length === 0) return null;
    return {
      t:         message.createdTimestamp,
      a:         message.member?.displayName ?? message.author.username,
      av:        message.author.displayAvatarURL({ size: 64, extension: "webp" }),
      color:     null,
      position:  null,
      heading:   null,
      styles:    { bold: false, italic: false, underline: false, strikethrough: false },
      p:         parts,
      charCount: countChars(parts),
    };
  }

  const rawContent = message.content;
  if (!rawContent.trim()) return null;

  const { color, position, heading, cleaned: afterMeta } = extractMeta(rawContent);

  console.log(`[parser] color=${color} pos=${position} heading=${heading} cleaned="${afterMeta}"`);

  const { bold, italic, underline, strikethrough, cleaned: afterStyles } =
    extractInlineStyles(afterMeta);

  const parts = parseTextSegments(afterStyles);
  if (parts.length === 0) return null;

  return {
    t:         message.createdTimestamp,
    a:         message.member?.displayName ?? message.author.username,
    av:        message.author.displayAvatarURL({ size: 64, extension: "webp" }),
    color,
    position,
    heading,
    styles:    { bold, italic, underline, strikethrough },
    p:         parts,
    charCount: countChars(parts),
  };
}