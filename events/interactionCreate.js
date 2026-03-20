import { Events, MessageFlags } from "discord.js";

export const name  = Events.InteractionCreate;
export const once  = false;

/**
 * @param {import("discord.js").Interaction} interaction
 * @param {import("discord.js").Client & { commands: Map<string, any> }} client
 */
export async function execute(interaction, client) {
  if (!interaction.isChatInputCommand()) return;

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
    console.error(`[interaction] /${interaction.commandName} 実行エラー:`, error);

    const payload = {
      content: "❌ コマンドの実行中にエラーが発生しました。",
      flags: MessageFlags.Ephemeral,
    };

    // すでに返答済みかどうかで分岐
    if (interaction.replied || interaction.deferred) {
      await interaction.followUp(payload);
    } else {
      await interaction.reply(payload);
    }
  }
}