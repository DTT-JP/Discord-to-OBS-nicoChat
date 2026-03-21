import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { ActiveSessionDB } from "../database.js";

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
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });

  const userId     = interaction.user.id;
  const maxComments = interaction.options.getInteger("limit", true);

  // アクティブセッションを取得
  const session = ActiveSessionDB.findByUserId(userId);

  if (!session) {
    return interaction.editReply({
      content: "❌ アクティブなセッションが見つかりません。先に `/start` を実行してください。",
    });
  }

  // DB 更新
  await ActiveSessionDB.updateMaxComments(session.socket_id, maxComments);

  // クライアントへリアルタイム通知
  if (updateLimitFn) {
    updateLimitFn(session.socket_id, maxComments);
  } else {
    console.error("[setlimit] updateLimitFn が未登録です");
  }

  return interaction.editReply({
    content: `✅ 同時表示上限を **${maxComments}件** に変更しました。`,
  });
}