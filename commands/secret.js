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
  .setDescription("隠しエフェクトコマンド（ブラックリスト外の全ユーザーが使用可能）")
  .addStringOption((opt) =>
    opt
      .setName("effect")
      .setDescription("適用するエフェクト")
      .setRequired(true)
      .addChoices(
        { name: "gaming — テキストを7色アニメーション", value: "gaming" },
        { name: "reverse — テキストを反転表示",         value: "reverse" },
        { name: "loop — 画面内をループ表示",             value: "loop" },
      ),
  )
  .addBooleanOption((opt) =>
    opt
      .setName("value")
      .setDescription("true = 有効化 / false = 無効化")
      .setRequired(true),
  );

export async function execute(interaction) {
  // ── ブラックリストチェック ────────────────────
  if (BlacklistDB.has(interaction.user.id)) {
    return interaction.reply({
      content: "このBotを利用する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const effect  = interaction.options.getString("effect", true);
  const value   = interaction.options.getBoolean("value", true);
  const channel = interaction.channelId;

  // そのチャンネルを監視しているセッションを取得
  const sessions = ActiveSessionDB.findByChannelId(channel);

  if (sessions.length === 0) {
    return interaction.editReply({
      content: `❌ このチャンネルを監視しているアクティブなセッションがありません。`,
    });
  }

  // セッション全体にエフェクトを適用
  if (applySecretFn) {
    applySecretFn(channel, effect, value);
  } else {
    console.error("[secret] applySecretFn が未登録です");
  }

  const stateLabel = value ? "✅ 有効化" : "❌ 無効化";
  return interaction.editReply({
    content: `${stateLabel}: エフェクト **${effect}** をこのチャンネルの全セッション（${sessions.length}件）に適用しました。`,
  });
}