import { Events, MessageFlags } from "discord.js";
import { GlobalBlacklistDB, GlobalGuildBlacklistDB } from "../database.js";
import { safeForLog } from "../utils/logSafe.js";
import { parsePageCustomId, handleListPageButton } from "../utils/paginatedList.js";
import { isHelpComponentInteraction, handleHelpComponent } from "../commands/help.js";
import { formatDateTime } from "../utils/moderation.js";

export const name  = Events.InteractionCreate;
export const once  = false;

/**
 * @param {import("discord.js").Interaction} interaction
 * @param {import("discord.js").Client & { commands: Map<string, any> }} client
 */
export async function execute(interaction, client) {
  // ── グローバルギルドブラックリストチェック ─────────
  // ブラックリスト対象ギルドでは、Bot管理者以外の利用を遮断する
  const botOwnerId = process.env.BOT_OWNER_ID?.trim();
  const isBotOwnerUser = !!botOwnerId && interaction.user?.id === botOwnerId;
  const guildId = interaction.guildId;
  if (guildId && !isBotOwnerUser) {
    const entry = await GlobalGuildBlacklistDB.find(guildId);
    if (entry) {
      const appealUrl = process.env.GLOBAL_GUILD_BLACKLIST_APPEAL_URL?.trim();
      const appealLine = appealUrl ? `異議申し立てはこちら: ${appealUrl}` : "異議申し立てはこちら: (URL未設定)";
      const reasonPublic = entry.public_reason?.trim() ? entry.public_reason.trim() : "（理由なし）";
      return interaction.reply({
        content: [
          "❌ このサーバーではこのBOTは使えません。",
          `理由（公開向け）: ${reasonPublic}`,
          `期限: 解除される日時（${formatDateTime(entry.expires_at)}）`,
          appealLine,
        ].join("\n"),
        flags: MessageFlags.Ephemeral,
      });
    }
  }

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
      return;
    }
  }

  if (isHelpComponentInteraction(interaction)) {
    try {
      await handleHelpComponent(interaction);
    } catch (error) {
      console.error("[interaction] ヘルプナビゲーション エラー:", safeForLog(error));
      const payload = { content: "❌ 操作中にエラーが発生しました。", flags: MessageFlags.Ephemeral };
      if (interaction.replied || interaction.deferred) {
        await interaction.followUp(payload).catch(() => {});
      } else {
        await interaction.reply(payload).catch(() => {});
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
