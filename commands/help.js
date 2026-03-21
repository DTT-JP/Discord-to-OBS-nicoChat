import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("コマンド一覧と使い方を表示します");

export async function execute(interaction) {
  const embed = new EmbedBuilder()
    .setTitle("📖 Discord OBS Overlay — ヘルプ")
    .setColor(0x5865f2)
    .setDescription("Discordのメッセージをリアルタイムでニコニコ風にOBSへ配信するBotです。")
    .addFields(
      // ── セットアップ ──────────────────────────
      {
        name:  "🔧 `/setup` （サーバーオーナー・管理者専用）",
        value: [
          "`/setup allow_role @ロール` — /start を許可するロールを追加",
          "`/setup remove_role @ロール` — /start の許可ロールを削除",
          "`/setup allow_user @ユーザー` — /start を許可するユーザーを追加",
          "`/setup remove_user @ユーザー` — /start の許可ユーザーを削除",
          "`/setup list` — 現在の許可リストを表示",
        ].join("\n"),
        inline: false,
      },
      // ── 基本コマンド ──────────────────────────
      {
        name:  "🎬 `/start #チャンネル [limit:数値]`",
        value: "OBSオーバーレイのセッションを開始します。\nDMにOBS用URLが送信されます。limit で同時表示上限を指定（デフォルト: 環境変数の MAX_COMMENTS）。",
        inline: false,
      },
      {
        name:  "🔐 `/auth [6桁コード]`",
        value: "OBSブラウザに表示されたコードを入力して認証を完了します。",
        inline: false,
      },
      {
        name:  "🔢 `/setlimit [数値]`",
        value: "配信中のセッションの同時表示上限をリアルタイムで変更します（1〜99999）。",
        inline: false,
      },
      {
        name:  "📊 `/status`",
        value: "CPU・メモリ使用率と自分のアクティブセッション状況を表示します。",
        inline: false,
      },
      // ── メタデータ書式 ──────────────────────────
      {
        name:  "🎨 メタデータ書式 `?属性 属性?`",
        value: [
          "メッセージ内の `?` と `?` の間に属性を指定します。",
          "テキストのどこに書いても認識されます。",
          "",
          "**色指定**",
          "`white` `red` `pink` `yellow` `orange`",
          "`green` `cyan` `blue` `purple` `black`",
          "`#HEXコード`（例: `#ff8800`）",
          "",
          "**サイズ指定**",
          "`big`（大）/ `medium`（中・デフォルト）/ `small`（小）",
          "Discord書式 `# テキスト`（H1〜H3、`-#`）でも指定可能",
          "",
          "**位置指定**",
          "`ue`（上固定・5秒表示）/ `shita`（下固定・5秒表示）",
          "指定なし → 画面を横断して流れます",
        ].join("\n"),
        inline: false,
      },
      // ── テキスト装飾 ──────────────────────────
      {
        name:  "✏️ Discord書式によるテキスト装飾",
        value: [
          "`**太字**` `*斜体*` `__下線__` `~~取り消し線~~`",
          "改行（Shift+Enter）→ 複数行表示・AA対応",
        ].join("\n"),
        inline: false,
      },
      // ── メタデータ隠しコマンド ────────────────
      {
        name:  "🔮 `? ?` 内の隠しコマンド",
        value: [
          "以下のコマンドを `? ?` 内に記述すると特殊効果が得られます。",
          "これらはそのメッセージのみに適用されます。",
          "",
          "`invisible` — コメントが動画上に表示されない",
          "`full` — コメントの臨界幅を変更",
          "`patissier` — コメント保持数の条件を変更",
          "`ender` — 改行リサイズを無効化",
          "`_live` — コメントを半透過表示",
          "`ca` — ニコる残存期間延長を回避",
        ].join("\n"),
        inline: false,
      },
      // ── 組み合わせ例 ──────────────────────────
      {
        name:  "💡 記述例",
        value: [
          "`?red ue? お知らせ` → 赤色・上固定",
          "`?blue big? **重要** テキスト` → 青色・大文字・太字・流れる",
          "`テキスト ?shita green?` → 緑色・下固定（どこに書いてもOK）",
          "`?invisible? 内緒のメッセージ` → オーバーレイに表示されない",
          "`?_live? 薄いコメント` → 半透過表示",
          "`?ender? 改行してもリサイズしないコメント`",
        ].join("\n"),
        inline: false,
      },
      // ── 認証フロー ────────────────────────────
      {
        name:  "📌 認証フロー",
        value: [
          "1. `/start #チャンネル` でURLを取得",
          "2. OBSのブラウザソースにURLを貼り付け",
          "3. 画面に表示された6桁コードを確認",
          "4. `/auth [コード]` で認証完了",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: "コメントは文字数が多いほど速く流れます | 一部コマンドは非公開です" })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}