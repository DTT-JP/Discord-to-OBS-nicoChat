/**
 * ログ出力用にトークン・コード・長い hex などをマスクする
 * @param {string} str
 * @returns {string}
 */
export function maskSecrets(str) {
  if (typeof str !== "string") return String(str);

  return str
    .replace(
      /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi,
      "[uuid]",
    )
    .replace(/\b[0-9a-f]{32,}\b/gi, "[hex]")
    .replace(/\b\d{6}\b/g, "[code]");
}

/**
 * console に渡す値をマスク（Error / 文字列 / そのまま）
 * @param {unknown} value
 * @returns {unknown}
 */
export function safeForLog(value) {
  if (value instanceof Error) {
    const combined = `${value.message}\n${value.stack ?? ""}`;
    return maskSecrets(combined);
  }
  if (typeof value === "string") return maskSecrets(value);
  if (value !== null && typeof value === "object") {
    try {
      return maskSecrets(JSON.stringify(value));
    } catch {
      return "[object]";
    }
  }
  return value;
}
