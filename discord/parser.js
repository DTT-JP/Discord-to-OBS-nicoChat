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
    // 拡張子チェック（pathname のみ使用し、クエリパラメータを除外する）
    // pathname 例: /attachments/123/456/image.png
    const pathname = url.pathname.toLowerCase();
    // pathname の末尾セグメントから拡張子を取得
    const lastSegment = pathname.split("/").pop() || "";
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex === -1) return false;
    const ext = lastSegment.slice(dotIndex + 1);
    if (!ext || !ALLOWED_IMAGE_EXTS.has(ext)) return false;
    return true;
  } catch {
    return false;
  }
}

/**
 * URLから拡張子を取得する（クエリパラメータを除外）
 * @param {string} urlStr
 * @returns {string}
 */
function getExtFromUrl(urlStr) {
  try {
    const url = new URL(urlStr);
    const pathname = url.pathname.toLowerCase();
    const lastSegment = pathname.split("/").pop() || "";
    const dotIndex = lastSegment.lastIndexOf(".");
    if (dotIndex === -1) return "";
    return lastSegment.slice(dotIndex + 1);
  } catch {
    return "";
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

  return { color, size, position, font, sessionFx, msgCommands, cleaned: cleaned.trim() };
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
 * テキスト中の Discord CDN 画像URLを検出して attachment パーツに変換する。
 * クエリパラメータ（?ex=...&format=webp 等）は拡張子判定に使用しない。
 * URLそのものはそのまま img.src に渡すため、クエリ付きでも正しく読み込まれる。
 * @param {string} seg - テキストセグメント
 * @returns {Array} text / attachment パーツの配列
 */
function splitTextWithImageUrls(seg) {
  // Discord CDN ホストの https:// URL を検出する正規表現
  // URL 末尾の判定: 空白・改行・< で終わり、またはテキスト末尾
  const RE_DISCORD_URL = /https:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net|images-ext-1\.discordapp\.net|images-ext-2\.discordapp\.net)\/\S+/g;

  const result = [];
  let last = 0;
  let m;

  RE_DISCORD_URL.lastIndex = 0;
  while ((m = RE_DISCORD_URL.exec(seg)) !== null) {
    // URL より前のテキストを追加
    if (m.index > last) {
      const before = seg.slice(last, m.index);
      if (before) result.push({ type: "text", content: before });
    }

    const rawUrl = m[0];
    // pathname から拡張子を取得（クエリパラメータを除外）
    const ext = getExtFromUrl(rawUrl);
    if (ALLOWED_IMAGE_EXTS.has(ext)) {
      // 許可された画像拡張子 → attachment パーツとして追加
      const isGif = ext === "gif";
      result.push({ type: "attachment", content: rawUrl, isGif, width: null, height: null });
    } else {
      // 拡張子が画像でない（または不明）→ テキストとしてそのまま残す
      result.push({ type: "text", content: rawUrl });
    }

    last = RE_DISCORD_URL.lastIndex;
  }

  RE_DISCORD_URL.lastIndex = 0;

  // URL より後のテキストを追加
  if (last < seg.length) {
    const after = seg.slice(last);
    if (after) result.push({ type: "text", content: after });
  }

  return result.length > 0 ? result : [{ type: "text", content: seg }];
}

/**
 * テキストをテキスト・絵文字・メンション・Discord CDN画像URLに分割する
 * @param {string} text
 * @param {Map<string, string|null>} mentionColorMap - userId -> roleColor (hex or null)
 * @returns {Array}
 */
function parseTextSegments(text, mentionColorMap = new Map()) {
  // 絵文字・メンションを先に分割し、残ったテキストセグメントをさらに画像URLで分割する
  const RE_EMOJI_OR_MENTION = /<(a?):([^:]+):(\d+)>|<@!?(\d+)>/g;

  const rawParts = [];
  let lastIndex = 0;
  let match;

  RE_EMOJI_OR_MENTION.lastIndex = 0;

  while ((match = RE_EMOJI_OR_MENTION.exec(text)) !== null) {
    if (match.index > lastIndex) {
      const seg = text.slice(lastIndex, match.index);
      if (seg) rawParts.push({ type: "text", content: seg });
    }

    if (match[3] !== undefined) {
      // カスタム絵文字: <(a?):name:id>
      const animated = match[1] === "a";
      const id       = match[3];
      rawParts.push({
        type:    "emoji",
        content: `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "webp"}?size=64`,
      });
    } else if (match[4] !== undefined) {
      // メンション: <@userId> or <@!userId>
      const userId = match[4];
      const roleColor = mentionColorMap.get(userId) ?? null;
      rawParts.push({
        type:      "mention",
        userId,
        roleColor,
        content:   `@${userId}`,
      });
    }

    lastIndex = RE_EMOJI_OR_MENTION.lastIndex;
  }

  RE_EMOJI_OR_MENTION.lastIndex = 0;

  if (lastIndex < text.length) {
    const seg = text.slice(lastIndex);
    if (seg) rawParts.push({ type: "text", content: seg });
  }

  // text パーツをさらに Discord CDN 画像URLで分割する
  const parts = [];
  for (const part of rawParts) {
    if (part.type === "text") {
      parts.push(...splitTextWithImageUrls(part.content));
    } else {
      parts.push(part);
    }
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

    // クエリパラメータを除外した pathname から拡張子を取得
    const ext = getExtFromUrl(url);
    const isGif = ext === "gif";

    parts.push({
      type:    "attachment",
      content: url,
      isGif,
      width:   attachment.width  ?? null,
      height:  attachment.height ?? null,
    });
  }
  return parts;
}

// ─────────────────────────────────────────────
// Discord embed 画像パーツ
// ─────────────────────────────────────────────

/**
 * message.embeds から画像（image / thumbnail）を抽出する。
 * Discord チャット上で画像URLをテキストとして貼り付けると
 * embeds[].image.url に格納される。
 * @param {import("discord.js").Collection | Array} embeds
 * @returns {Array}
 */
function parseEmbedImageParts(embeds) {
  const parts = [];
  for (const embed of embeds) {
    // embed.image: { url, proxyURL, width, height }
    const imgUrl = embed.image?.url ?? embed.image?.proxyURL ?? null;
    if (imgUrl && isAllowedImageUrl(imgUrl)) {
      const ext = getExtFromUrl(imgUrl);
      const isGif = ext === "gif";
      parts.push({
        type:    "attachment",
        content: imgUrl,
        isGif,
        width:   embed.image?.width  ?? null,
        height:  embed.image?.height ?? null,
      });
    }
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

  // テキストなし・添付なし・embedのみ（画像URL貼り付け等）の場合
  if (!rawContent.trim() && message.embeds.length > 0) {
    const parts = parseEmbedImageParts(message.embeds);
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

  // ⑥ テキストメッセージに embed 画像が付いている場合（例: テキスト + URL貼り付け）
  if (message.embeds.length > 0) {
    const embedParts = parseEmbedImageParts(message.embeds);
    parts.push(...embedParts);
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
    layer,
  };
}