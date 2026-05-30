import { StickerFormatType } from "discord.js";

// ─────────────────────────────────────────────
// グローバル定数
// ─────────────────────────────────────────────

/** カスタム絵文字: while ループで使うため g フラグ必須 */
const RE_ANY_EMOJI = /<(a?):([^:]+):(\d+)>/g;

/** Discord 見出し: g フラグなし・exec() 1回のみ使用するため安全 */
const RE_HEADING = /^(-#|#{1,3})\s*/;

/** メンション: while ループで使うため g フラグ必須 */
const RE_MENTION = /<@!?(\d+)>/g;

// 許可する添付画像の拡張子
const ALLOWED_IMAGE_EXTS = new Set(["jpg", "jpeg", "png", "gif", "bmp", "webp"]);

// 許可する添付画像のホスト（Discord CDN）
const ALLOWED_IMAGE_HOSTS = new Set([
  "cdn.discordapp.com",
  "media.discordapp.net",
  "images-ext-1.discordapp.net",
  "images-ext-2.discordapp.net",
]);

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

// フォント指定値
const VALID_FONTS = new Set(["gothic", "mincho"]);

// ─────────────────────────────────────────────
// 添付画像バリデーション
// ─────────────────────────────────────────────

/**
 * URLが許可された画像URLかチェックする
 * @param {string} urlStr
 * @returns {boolean}
 */
function isAllowedImageUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    // HTTPSのみ許可
    if (url.protocol !== "https:") return false;
    // 許可ホストのみ
    if (!ALLOWED_IMAGE_HOSTS.has(url.hostname)) return false;
    // 拡張子チェック（クエリ除去してチェック）
    const pathname = url.pathname.toLowerCase();
    const ext = pathname.split(".").pop();
    if (!ext || !ALLOWED_IMAGE_EXTS.has(ext)) return false;
    return true;
  } catch {
    return false;
  }
}

// ─────────────────────────────────────────────
// V2 メタブロックパーサー
// ─────────────────────────────────────────────

function parseMetaBlock(raw) {
  let color       = null;
  let size        = null;
  let position    = null;
  let font        = null;
  const sessionFx   = [];
  const msgCommands = [];

  const cleaned = raw.replace(/\?([^?]+)\?/g, (_, attrsRaw) => {
    const attrs = attrsRaw.trim().toLowerCase().split(/\s+/);

    for (const attr of attrs) {
      if (NAMED_COLORS[attr] !== undefined) { color = NAMED_COLORS[attr]; continue; }
      if (/^#[0-9a-f]{3}(?:[0-9a-f]{3})?$/.test(attr)) { color = attr; continue; }
      if (attr === "big" || attr === "medium" || attr === "small") { size = attr; continue; }
      if (attr === "ue")    { position = "ue";    continue; }
      if (attr === "shita") { position = "shita"; continue; }
      if (VALID_FONTS.has(attr)) { font = attr; continue; }
      if (SESSION_EFFECTS.has(attr)) { sessionFx.push(attr); continue; }
      const normalized = attr.replace(/^\u3000/, "_live");
      if (MSG_COMMANDS.has(normalized)) { msgCommands.push(normalized); continue; }
      if (MSG_COMMANDS.has(attr)) { msgCommands.push(attr); }
    }

    return "";
  });

  // ── 修正: 文末の半角スペース・タブのみ除去（全角スペース・特殊空白は保持） ──
  // 旧: cleaned.trim() → 文頭・文末の全空白を除去していた
  // 新: 末尾の半角スペース・タブのみ除去。CA用の特殊空白(U+2004等)や
  //     全角スペースは「幅を持つ文字」として保持する。
  return { color, size, position, font, sessionFx, msgCommands, cleaned: cleaned.replace(/[ \t]+$/, "") };
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

  if (/~~(.+?)~~/gs.test(text)) {
    strikethrough = true;
    text = text.replace(/~~(.+?)~~/gs, "$1");
  }
  if (/__(.+?)__/gs.test(text)) {
    underline = true;
    text = text.replace(/__(.+?)__/gs, "$1");
  }
  if (/\*\*(.+?)\*\*/gs.test(text)) {
    bold = true;
    text = text.replace(/\*\*(.+?)\*\*/gs, "$1");
  }
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
// テキストセグメント分割（メンション情報付き）
// ─────────────────────────────────────────────

/**
 * テキストをテキスト・絵文字・メンションに分割する
 * @param {string} text
 * @param {Map<string, string|null>} mentionColorMap - userId -> roleColor (hex or null)
 * @returns {Array}
 */
function parseTextSegments(text, mentionColorMap = new Map()) {
  // まず絵文字とメンションを混在させて分割する
  // 両方の正規表現を統合して処理する
  const RE_EMOJI_OR_MENTION = /<(a?):([^:]+):(\d+)>|<@!?(\d+)>/g;

  const parts = [];
  let lastIndex = 0;
  let match;

  RE_EMOJI_OR_MENTION.lastIndex = 0;

  while ((match = RE_EMOJI_OR_MENTION.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const seg = text.slice(lastIndex, match.index);
      if (seg) parts.push({ type: "text", content: seg });
    }

    if (match[3] !== undefined) {
      // カスタム絵文字: <(a?):name:id>
      const animated = match[1] === "a";
      const id       = match[3];
      parts.push({
        type:    "emoji",
        content: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=64`,
      });
    } else if (match[4] !== undefined) {
      // メンション: <@userId> or <@!userId>
      const userId = match[4];
      const roleColor = mentionColorMap.get(userId) ?? null;
      parts.push({
        type:      "mention",
        userId,
        roleColor, // hex string or null
        content:   `@${userId}`, // フォールバック表示テキスト
      });
    }

    lastIndex = RE_EMOJI_OR_MENTION.lastIndex;
  }

  RE_EMOJI_OR_MENTION.lastIndex = 0;

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
      format = "apng"; ext = "png";
    } else if (sticker.format === StickerFormatType.GIF) {
      format = "gif"; ext = "gif";
    } else if (sticker.format === StickerFormatType.Lottie) {
      format = "lottie"; ext = "json";
    }

    parts.push({
      type:          "sticker",
      stickerId:     sticker.id,
      stickerFormat: format,
      content:       `https://cdn.discordapp.com/stickers/${sticker.id}.${ext}?size=320`,
    });
  }
  return parts;
}

// ─────────────────────────────────────────────
// 添付画像パーツ
// ─────────────────────────────────────────────

/**
 * message.attachments から許可された画像だけを抽出する
 * @param {import("discord.js").Collection} attachments
 * @returns {Array}
 */
function parseAttachmentParts(attachments) {
  const parts = [];
  for (const attachment of attachments.values()) {
    const url = attachment.url;
    if (!isAllowedImageUrl(url)) continue;

    // 拡張子を取得（GIF判定用）
    const pathname = new URL(url).pathname.toLowerCase();
    const ext = pathname.split(".").pop();
    const isGif = ext === "gif";

    parts.push({
      type:    "attachment",
      content: url,
      isGif,   // trueならCanvas静止化が必要
      width:   attachment.width  ?? null,
      height:  attachment.height ?? null,
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
        if (i < segments.length - 1) { flushLine(); currentLine = 0; }
      }
      continue;
    }
    if (part.type === "emoji" || part.type === "sticker" || part.type === "attachment" || part.type === "mention") {
      currentLine += 1;
    }
  }

  flushLine();
  return maxLine;
}

// ─────────────────────────────────────────────
// メインパーサー
// ─────────────────────────────────────────────

/**
 * @param {import("discord.js").Message} message
 * @param {Set<string>|string[]} watchChannelIds
 * @param {object} [options]
 * @param {boolean} [options.isAdmin] - 管理者コメントか
 * @param {boolean} [options.mentionsSessionOwner] - セッション主へのメンションを含むか
 * @param {Map<string, string|null>} [options.mentionColorMap] - メンションのロール色マップ
 */
export function parseMessage(message, watchChannelIds, options = {}) {
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

  const {
    isAdmin             = false,
    mentionsSessionOwner = false,
    mentionColorMap     = new Map(),
  } = options;

  // ── スタンプ専用 ──────────────────────────────
  if (message.stickers.size > 0) {
    const parts = parseStickerParts(message.stickers);
    if (parts.length === 0) return null;
    return {
      t:                   message.createdTimestamp,
      a:                   message.member?.displayName ?? message.author.username,
      av:                  message.author.displayAvatarURL({ size: 64, extension: "webp" }),
      color:               null,
      size:                "medium",
      font:                null,
      position:            null,
      sessionFx:           [],
      msgCommands:         [],
      styles:              { bold: false, italic: false, underline: false, strikethrough: false },
      p:                   parts,
      charCount:           countChars(parts),
      isAdmin,
      mentionsSessionOwner,
      layer:               isAdmin ? "admin" : "normal",
    };
  }

  // ── 添付画像のみ（テキストなし）──────────────────
  if (!message.content.trim() && message.attachments.size > 0) {
    const parts = parseAttachmentParts(message.attachments);
    if (parts.length === 0) return null;
    return {
      t:                   message.createdTimestamp,
      a:                   message.member?.displayName ?? message.author.username,
      av:                  message.author.displayAvatarURL({ size: 64, extension: "webp" }),
      color:               null,
      size:                "medium",
      font:                null,
      position:            null,
      sessionFx:           [],
      msgCommands:         [],
      styles:              { bold: false, italic: false, underline: false, strikethrough: false },
      p:                   parts,
      charCount:           countChars(parts),
      isAdmin,
      mentionsSessionOwner,
      layer:               isAdmin ? "admin" : mentionsSessionOwner ? "priority" : "normal",
    };
  }

  // ── テキストメッセージ ────────────────────────
  const rawContent = message.content;
  if (!rawContent.trim()) return null;

  // ① メタブロック解析
  const {
    color, size: metaSize, position, font, sessionFx, msgCommands, cleaned: afterMeta,
  } = parseMetaBlock(rawContent);

  // ② Discord見出しからサイズ推測
  let size         = metaSize;
  let afterHeading = afterMeta;
  if (!size) {
    const h  = extractHeadingSize(afterMeta);
    size         = h.size ?? "medium";
    afterHeading = h.cleaned;
  }

  // ③ インライン書式
  const { bold, italic, underline, strikethrough, cleaned: afterStyles } = extractInlineStyles(afterHeading);

  // ④ テキスト分割（メンション情報付き）
  const parts = parseTextSegments(afterStyles, mentionColorMap);

  // ⑤ 添付画像を末尾に追加
  if (message.attachments.size > 0) {
    const attachParts = parseAttachmentParts(message.attachments);
    parts.push(...attachParts);
  }

  if (parts.length === 0) return null;

  // レイヤー決定
  let layer = "normal";
  if (isAdmin) layer = "admin";
  else if (mentionsSessionOwner) layer = "priority";

  return {
    t:                   message.createdTimestamp,
    a:                   message.member?.displayName ?? message.author.username,
    av:                  message.author.displayAvatarURL({ size: 64, extension: "webp" }),
    color,
    size,
    font,
    position,
    sessionFx,
    msgCommands,
    styles:              { bold, italic, underline, strikethrough },
    p:                   parts,
    charCount:           countChars(parts),
    isAdmin,
    mentionsSessionOwner,
    layer,               // "admin" | "priority" | "normal"
  };
}