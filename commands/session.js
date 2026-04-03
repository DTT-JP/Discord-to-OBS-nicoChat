import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB, GlobalBlacklistDB } from "../database.js";

export const data = new SlashCommandBuilder()
  .setName("session")
  .setDescription("自分のセッション設定（limit / secret許可）を変更します")
  .addChannelOption((opt) =>
    opt
      .setName("channel")
      .setDescription("対象チャンネル（未指定なら実行チャンネル）")
      .setRequired(false),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("同時表示コメント上限（1〜99999）")
      .setMinValue(1)
      .setMaxValue(99999)
      .setRequired(false),
  )
  .addStringOption((opt) =>
    opt
      .setName("secret")
      .setDescription("secretコマンドの許可設定")
      .addChoices(
        { name: "許可", value: "allow" },
        { name: "拒否", value: "deny" },
      )
      .setRequired(false),
  );

let updateLimitFn = null;
export function setUpdateLimitFn(fn) {
  updateLimitFn = fn;
}

export async function execute(interaction) {
  if (GlobalBlacklistDB.has(interaction.user.id)) {
    return interaction.reply({
      content: "このBotを利用する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const channel = interaction.options.getChannel("channel", false);
  const channelId = channel?.id ?? interaction.channelId;
  const limit = interaction.options.getInteger("limit", false);
  const secret = interaction.options.getString("secret", false);
  const secretAllowed = secret == null ? null : secret !== "deny";

  if (limit == null && secretAllowed == null) {
    return interaction.editReply({
      content: "❌ `limit` または `secret` のどちらかを指定してください。",
    });
  }

  const ownSessions = ActiveSessionDB
    .findByChannelId(channelId)
    .filter((s) => s.user_id === interaction.user.id);
  if (ownSessions.length === 0) {
    return interaction.editReply({
      content: "❌ このチャンネルにあなたが作成したセッションがありません。",
    });
  }

  await ActiveSessionDB.updateSessionSettingsForOwnerInChannel(interaction.user.id, channelId, {
    max_comments: limit ?? undefined,
    secret_allowed: secretAllowed ?? undefined,
  });

  if (limit != null) {
    for (const s of ownSessions) {
      if (!s.socket_id || !updateLimitFn) continue;
      updateLimitFn(s.socket_id, limit);
    }
  }

  const changed = [];
  if (limit != null) changed.push(`limit=${limit}`);
  if (secretAllowed != null) changed.push(`secret=${secretAllowed ? "許可" : "拒否"}`);
  return interaction.editReply({
    content: `✅ セッション設定を更新しました（${changed.join(" / ")}）。`,
  });
}
