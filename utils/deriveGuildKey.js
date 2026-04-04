import { createHash, hkdfSync } from "node:crypto";

/**
 * .env の MASTER_KEY を 32 バイト IKM に正規化する
 * - 64 文字の hex → そのままバイナリ
 * - それ以外 → UTF-8 の SHA-256
 * @returns {Buffer}
 */
export function getMasterKeyMaterial() {
  const raw = process.env.MASTER_KEY?.trim();
  if (!raw) {
    throw new Error("MASTER_KEY が設定されていません");
  }
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    return Buffer.from(raw, "hex");
  }
  return createHash("sha256").update(raw, "utf8").digest();
}

/**
 * MASTER_KEY と Discord guild.id から HKDF でギルド専用の AES-256 鍵（hex 64 文字）を派生する
 * @param {string} guildId
 * @returns {string}
 */
export function deriveGuildSettingsKeyHex(guildId) {
  const ikm  = getMasterKeyMaterial();
  const salt = Buffer.from(`d2obs|guild|${guildId}`, "utf8");
  const info = Buffer.from("d2obs-guild-settings-v1", "utf8");
  // Node.js 22+ では hkdfSync が ArrayBuffer を返すことがあり、
  // ArrayBuffer に .toString("hex") すると鍵にならない文字列になる（Invalid key length の原因）
  const raw = hkdfSync("sha256", ikm, salt, info, 32);
  return Buffer.from(raw).toString("hex");
}
