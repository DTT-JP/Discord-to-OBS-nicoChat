/**
 * Discord API 登録前にコマンドJSONを正規化する。
 *
 * - 同名オプションを除去（先勝ち）
 * - required=true を required=false より前へ並べる
 *
 * deploy-commands.js / deploy-commands-guild.js の両方から使用する。
 *
 * @param {any} node
 * @returns {any}
 */
export function sanitizeCommandNode(node) {
  if (!node || typeof node !== "object") return node;

  const out = { ...node };
  if (!Array.isArray(out.options)) return out;

  // 子要素を再帰的に正規化
  const normalizedChildren = out.options.map((child) => sanitizeCommandNode(child));

  // 同名オプション除去（先勝ち）
  const seen = new Set();
  const uniqueChildren = normalizedChildren.filter((child) => {
    const key = `${child.type}:${child.name}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // required オプションは先頭へ（同グループ内の順序は維持）
  out.options = [
    ...uniqueChildren.filter((child) => child.required === true),
    ...uniqueChildren.filter((child) => child.required !== true),
  ];

  return out;
}
