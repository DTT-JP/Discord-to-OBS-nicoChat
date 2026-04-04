import { computeExpireAt } from "./moderation.js";

const VALID_UNITS = new Set(["minute", "hour", "day", "week", "month", "year"]);

/**
 * スラッシュコマンドの duration_value / duration_unit オプションを解析し、
 * ブラックリストの期限（Unix ミリ秒）を返す。
 *
 * 無制限にする場合は duration_value と duration_unit の**両方**に
 * 文字列 "infinity"（大文字小文字不問）を指定する。
 * どちらか一方だけの場合はエラーを返す。
 *
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {string} valueOpt - duration_value オプション名
 * @param {string} unitOpt  - duration_unit オプション名
 * @returns {{ expiresAt: number | null } | { error: string }}
 */
export function parseDurationValueAndUnit(interaction, valueOpt = "duration_value", unitOpt = "duration_unit") {
  const rawVal  = interaction.options.getString(valueOpt, true).trim();
  const rawUnit = interaction.options.getString(unitOpt, true).trim();

  // 比較はどちらも小文字に正規化してから行う
  const valLower  = rawVal.toLowerCase();
  const unitLower = rawUnit.toLowerCase();

  const valIsInfinity  = valLower  === "infinity";
  const unitIsInfinity = unitLower === "infinity";

  // 両方 infinity → 無制限（expiresAt = null）
  if (valIsInfinity && unitIsInfinity) {
    return { expiresAt: null };
  }

  // 片方だけ infinity → 設定ミスとしてエラー
  if (valIsInfinity !== unitIsInfinity) {
    return {
      error:
        "❌ 無制限にする場合は、`duration_value` と `duration_unit` の**両方**に正確に `infinity` を指定してください。どちらか一方だけでは無効です。",
    };
  }

  // 通常の数値指定
  const n = Number.parseInt(rawVal, 10);
  if (!Number.isInteger(n) || n < 1) {
    return {
      error:
        "❌ `duration_value` には **1 以上の整数**を入れてください（例: `7`）。`duration_unit` は分・時間・日・週・月・年のいずれかを選んでください。無制限は **両方** `infinity` です。",
    };
  }

  if (!VALID_UNITS.has(unitLower)) {
    return {
      error:
        "❌ `duration_unit` が不正です。分〜年から選ぶか、無制限は `duration_value` と `duration_unit` **両方** `infinity` にしてください。",
    };
  }

  const expiresAt = computeExpireAt(unitLower, n);
  return { expiresAt };
}
