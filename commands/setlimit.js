import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB, AllowedPrincipalDB } from "../database.js";
import { isAdminOrOwner } from "../utils/moderation.js";

export const data = new SlashCommandBuilder()
  .setName("setlimit")
  .setDescription("動作中のオーバーレイセッションの同時表示上限を変更します")
  .addIntegerOption((opt) =>
    opt
      .setName("limit")
      .setDescription("新しい同時表示コメント上限数（1〜99999）")
      .setMinValue(1)
      .setMaxValue(99999)
      .setRequired(true),
  );

// socket/manager.js から注入されるコールバック
/** @type {((socketId: string, maxComments: number) => void) | null} */
let updateLimitFn = null;

/**
 * Socket Manager から呼び出し、上限更新関数を登録する
 * @param {(socketId: string, maxComments: number) => void} fn
 */
export function setUpdateLimitFn(fn) {
  updateLimitFn = fn;
}

export async function execute(interaction) {
  const member = interaction.member;
  if (!member || (!isAdminOrOwner(interaction) && !AllowedPrincipalDB.isAllowed(member))) {
    return interaction.reply({
      content:
        "❌ このコマンドを実行する権限がありません。\n管理者に `/setup allow_start_role` または `/setup allow_start_user` での許可を依頼してください。",
      flags: MessageFlags.Ephemeral,
    });
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId      = interaction.user.id;
  const maxComments = interaction.options.getInteger("limit", true);

  // アクティブセッションを取得
  const session = ActiveSessionDB.findByUserId(userId);

  if (!session) {
    return interaction.editReply({
      content: "❌ アクティブなセッションが見つかりません。先に `/start` を実行してください。",
    });
  }

  // DB 更新（PM2 リロード直後は socket_id が空の可能性があるためユーザー単位で更新）
  await ActiveSessionDB.updateMaxCommentsForUser(userId, maxComments);
  const refreshed = ActiveSessionDB.findByUserId(userId);

  // クライアントへリアルタイム通知
  if (updateLimitFn && refreshed?.socket_id) {
    updateLimitFn(refreshed.socket_id, maxComments);
  } else if (!updateLimitFn) {
    console.error("[setlimit] updateLimitFn が未登録です");
  }
  // socket 未接続時は DB のみ更新（再接続後は初期値で上書きされないよう保持）

  return interaction.editReply({
    content: `✅ 同時表示上限を **${maxComments}件** に変更しました。`,
  });
}
