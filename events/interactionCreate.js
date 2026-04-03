import { Events, MessageFlags } from "discord.js";
import { GlobalBlacklistDB } from "../database.js";
import { safeForLog } from "../utils/logSafe.js";
import { parsePageCustomId, handleListPageButton } from "../utils/paginatedList.js";

export const name  = Events.InteractionCreate;
export const once  = false;

/**
 * @param {import("discord.js").Interaction} interaction
 * @param {import("discord.js").Client & { commands: Map<string, any> }} client
 */
export async function execute(interaction, client) {
  if (interaction.isButton()) {
    const parsed = parsePageCustomId(interaction.customId);
    if (parsed) {
      try {
        await handleListPageButton(interaction, parsed);
      } catch (error) {
        console.error("[interaction] 一覧ページボタン エラー:", safeForLog(error));
        const payload = { content: "❌ 操作中にエラーが発生しました。", flags: MessageFlags.Ephemeral };
        if (interaction.replied || interaction.deferred) {
          await interaction.followUp(payload).catch(() => {});
        } else {
          await interaction.reply(payload).catch(() => {});
        }
      }
    }
    return;
  }

  if (!interaction.isChatInputCommand()) return;
  const subcommand = interaction.options.getSubcommand(false);

  // ── グローバルブラックリストチェック ──────────
  // コマンド実行自体を遮断する（ローカルBLはコマンドは許可・OBSのみ遮断）
  const isMyStatusCheck = interaction.commandName === "my-status";
  if (GlobalBlacklistDB.has(interaction.user.id) && !isMyStatusCheck) {
    return interaction.reply({
      content: "このBotを利用する権限がありません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const command = client.commands.get(interaction.commandName);

  if (!command) {
    console.warn(`[interaction] 未登録コマンド: ${interaction.commandName}`);
    return interaction.reply({
      content: "❌ このコマンドは現在利用できません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  try {
    await command.execute(interaction);
  } catch (error) {
    console.error(`[interaction] /${interaction.commandName} 実行エラー:`, safeForLog(error));
    const payload = {
      content: "❌ コマンドの実行中にエラーが発生しました。",
      flags: MessageFlags.Ephemeral,
    };
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
}
