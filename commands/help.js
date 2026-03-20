import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";
export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("コマンド一覧と使い方を表示します");

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Discord OBS Overlay - ヘルプ")
    .setColor(0x5865f2)
    .setDescription("Discordのメッセージをリアルタイムでニコニコ風にOBSへ配信するBotです。")
    .addFields(
      {
        name:  "🔧 `/setup` （サーバーオーナー専用）",
        value: [
          "`/setup allow_role @ロール` — /start を許可するロールを追加",
          "`/setup remove_role @ロール` — /start の許可ロールを削除",
          "`/setup allow_user @ユーザー` — /start を許可するユーザーを追加",
          "`/setup remove_user @ユーザー` — /start の許可ユーザーを削除",
          "`/setup list` — 現在の許可リストを表示",
        ].join("\n"),
        inline: false,
      },
      {
        name:  "🎬 `/start #チャンネル`",
        value: "OBSオーバーレイのセッションを開始します。\nDMにOBS用のURLが送信されます。",
        inline: false,
      },
      {
        name:  "🔐 `/auth [6桁コード]`",
        value: "OBSブラウザに表示されたコードを入力して認証を完了します。",
        inline: false,
      },
      {
        name:  "📊 `/status`",
        value: "CPU・メモリ使用率とアクティブセッション数を表示します。",
        inline: false,
      },
      {
        name:  "🎨 コメント装飾コマンド",
        value: [
          "**色指定（メッセージ先頭）**",
          "`[赤]` `[青]` `[黄]` `[緑]` `[白]`",
          "`[red]` `[blue]` `[yellow]` `[green]` `[white]`",
          "",
          "**位置指定（色の後でも可）**",
          "`[上]` `[top]` — 上部に表示",
          "`[下]` `[bottom]` — 下部に表示",
          "",
          "**Discord書式**",
          "`# テキスト` — 大見出し（2em）",
          "`## テキスト` — 中見出し（1.5em）",
          "`### テキスト` — 小見出し（1.17em）",
          "`**太字**` `*斜体*` `__下線__` `~~取り消し線~~`",
        ].join("\n"),
        inline: false,
      },
      {
        name:  "📌 認証フロー",
        value: "1. `/start #チャンネル` でURLを取得\n2. OBSブラウザソースにURLを貼り付け\n3. 画面に表示された6桁コードを確認\n4. `/auth [コード]` で認証完了",
        inline: false,
      },
    )
    .setFooter({ text: "コメントは文字数が多いほど速く流れます" })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}