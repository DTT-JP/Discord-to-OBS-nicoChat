import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, ActiveSessionDB, AllowedPrincipalDB } from "../database.js";
import { isAdminOrOwner } from "../utils/moderation.js";

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
  .setDescription(".")
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription(".")
      .setRequired(true)
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
  // ── グローバルブラックリストチェック ──────────
  if (GlobalBlacklistDB.has(interaction.user.id)) {
    return interaction.reply({
      content: "このBotを利用する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const member = interaction.member;
  if (!member || (!isAdminOrOwner(interaction) && !AllowedPrincipalDB.isAllowed(member))) {
    return interaction.reply({
      content:
        "❌ このコマンドを実行する権限がありません。\n管理者に `/setup allow_start_role` または `/setup allow_start_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const effect  = interaction.options.getString("effect", true).trim().toLowerCase();
  const value   = interaction.options.getBoolean("value", true);
  const channel = interaction.channelId;

  if (!VALID_EFFECTS.has(effect)) {
    return interaction.editReply({ content: "." });
  }

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

  return interaction.editReply({ content: value ? "." : ".." });
}
