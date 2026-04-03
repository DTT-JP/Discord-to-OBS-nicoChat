import { computeExpireAt } from "./moderation.js";

const VALID_UNITS = new Set(["minute", "hour", "day", "week", "month", "year"]);

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 * @param {string} valueOpt
 * @param {string} unitOpt
 */
export function parseDurationValueAndUnit(interaction, valueOpt = "duration_value", unitOpt = "duration_unit") {
  const rawVal = interaction.options.getString(valueOpt, true).trim();
  const unitRaw = interaction.options.getString(unitOpt, true).trim();
  const unit = unitRaw.toLowerCase();

  const valInf = rawVal.toLowerCase() === "infinity";
  const unitInf = unit === "infinity";

  if (valInf && unitInf) {
    return { expiresAt: null };
  }

  if (valInf !== unitInf) {
    return {
      error:
        "❌ 無制限にする場合は、`duration_value` と `duration_unit` の**両方**に正確に `infinity` を指定してください。どちらか一方だけでは無効です。",
    };
  }

  const n = Number.parseInt(rawVal, 10);
  if (!Number.isInteger(n) || n < 1) {
    return {
      error:
        "❌ `duration_value` には **1 以上の整数**を入れてください（例: `7`）。`duration_unit` は分・時間・日・週・月・年のいずれかを選んでください。無制限は **両方** `infinity` です。",
    };
  }

  if (!VALID_UNITS.has(unit)) {
    return {
      error:
        "❌ `duration_unit` が不正です。分〜年から選ぶか、無制限は `duration_value` と `duration_unit` **両方** `infinity` にしてください。",
    };
  }

  const expiresAt = computeExpireAt(unit, n);
  return { expiresAt };
}
