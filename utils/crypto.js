import { randomBytes, createCipheriv, createDecipheriv } from "node:crypto";

const ALGORITHM  = "aes-256-gcm";
const IV_LENGTH  = 12; // GCM 推奨値
const TAG_LENGTH = 16; // Auth Tag バイト数（固定）
const KEY_LENGTH = 32; // AES-256 = 32バイト

// ─────────────────────────────────────────────
// 鍵生成
// ─────────────────────────────────────────────

/**
 * AES-256 用のランダム鍵を生成する
 * @returns {string} 64文字の hex 文字列（32バイト）
 */
export function generateAesKey() {
  return randomBytes(KEY_LENGTH).toString("hex");
}

/**
 * 6桁のランダム認証コードを生成する
 * Math.random() ではなく crypto を使用し予測不可能性を担保
 * @returns {string} "000000" 〜 "999999"
 */
export function generateAuthCode() {
  // 3バイト（0〜16777215）を取得し、下6桁を使用
  const num = randomBytes(3).readUIntBE(0, 3) % 1_000_000;
  return String(num).padStart(6, "0");
}

// ─────────────────────────────────────────────
// 暗号化
// ─────────────────────────────────────────────

/**
 * AES-256-GCM で平文を暗号化する
 * @param {string} plainText - 暗号化する文字列（JSON文字列を想定）
 * @param {string} keyHex    - 64文字の hex 鍵文字列
 * @returns {string} "iv_hex:authTag_hex:ciphertext_hex" 形式
 */
export function encrypt(plainText, keyHex) {
  const key        = Buffer.from(keyHex, "hex");
  const iv         = randomBytes(IV_LENGTH);
  const cipher     = createCipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });

  const encrypted  = Buffer.concat([
    cipher.update(plainText, "utf8"),
    cipher.final(),
  ]);
  const authTag    = cipher.getAuthTag();

  return [
    iv.toString("hex"),
    authTag.toString("hex"),
    encrypted.toString("hex"),
  ].join(":");
}

// ─────────────────────────────────────────────
// 復号
// ─────────────────────────────────────────────

/**
 * AES-256-GCM で暗号文を復号する
 * @param {string} payload - "iv_hex:authTag_hex:ciphertext_hex" 形式
 * @param {string} keyHex  - 64文字の hex 鍵文字列
 * @returns {string} 復号された平文
 * @throws {Error} 改ざん検知時（Auth Tag 不一致）または形式不正時
 */
export function decrypt(payload, keyHex) {
  const parts = payload.split(":");
  if (parts.length !== 3) {
    throw new Error("不正なペイロード形式です");
  }

  const [ivHex, authTagHex, ciphertextHex] = parts;
  const key        = Buffer.from(keyHex, "hex");
  const iv         = Buffer.from(ivHex, "hex");
  const authTag    = Buffer.from(authTagHex, "hex");
  const ciphertext = Buffer.from(ciphertextHex, "hex");

  const decipher   = createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
  decipher.setAuthTag(authTag);

  const decrypted  = Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(), // Auth Tag 検証はここで行われる
  ]);

  return decrypted.toString("utf8");
}