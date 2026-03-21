import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { BlacklistDB, ActiveSessionDB } from "../database.js";

/** セッションエフェクト更新関数（manager.js から注入） */
let applySecretFn = null;

/**
 * @param {(channelId: string, effect: string, value: boolean) => void} fn
 */
export function setApplySecretFn(fn) {
  applySecretFn = fn;
}

export const data = new SlashCommandBuilder()
  .setName("secret")
  .setDescription(".")  // 説明を隠す（一覧に表示されるが内容は非公開）
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription(".")   // 説明を隠す
      .setRequired(true)
      // addChoices を使わずフリーテキスト入力にする
      // オートコンプリートも設定しない → 一覧に候補が出ない
  )
  .addBooleanOption((opt) =>
    opt
      .setName("value")
      .setDescription("true = 有効化 / false = 無効化")
      .setRequired(true),
  );

/** 有効なセッションエフェクト一覧（非公開） */
const VALID_EFFECTS = new Set(["gaming", "reverse"]);

export async function execute(interaction) {
  // ── ブラックリストチェック ────────────────────
  if (BlacklistDB.has(interaction.user.id)) {
    return interaction.reply({
      content: "このBotを利用する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const effect  = interaction.options.getString("effect", true).trim().toLowerCase();
  const value   = interaction.options.getBoolean("value", true);
  const channel = interaction.channelId;

  // 有効なエフェクトか検証（無効な入力は何も言わずに弾く）
  if (!VALID_EFFECTS.has(effect)) {
    return interaction.editReply({ content: "." });
  }

  // そのチャンネルを監視しているセッションを取得
  const sessions = ActiveSessionDB.findByChannelId(channel);

  if (sessions.length === 0) {
    return interaction.editReply({
      content: "❌ このチャンネルを監視しているアクティブなセッションがありません。",
    });
  }

  if (applySecretFn) {
    applySecretFn(channel, effect, value);
  } else {
    console.error("[secret] applySecretFn が未登録です");
  }

  // 成功時も最低限のレスポンスのみ（内容を明かさない）
  return interaction.editReply({ content: value ? "." : ".." });
}