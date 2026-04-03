import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from "discord.js";
import { VERSION } from "../utils/version.js";

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
        name:  "🔧 `/config` （サーバーオーナー・管理者のみ）",
        value: [
          "`/setup` 実行許可: `add_setup_role` / `del_setup_role` / `add_setup_user` / `del_setup_user`",
          "一覧: `setup_role_list` / `setup_user_list`（`page` で開始ページ、◀▶ で送り）",
          "`/blacklist` 操作許可: `ctrl_blacklist_role` / `remove_ctrl_blacklist_role` / `ctrl_blacklist_user` / `remove_ctrl_blacklist_user`",
          "一覧: `ctrl_blacklist_role_list` / `ctrl_blacklist_user_list`",
        ].join("\n"),
        inline: false,
      },
      {
        name:  "⚙️ `/setup` （オーナー・管理者、または `/config` で許可された人）",
        value: [
          "`overview` — 拒否チャンネル・/start 許可・オーバーレイURLの概要",
          "`deny_channel_list` / `allow_start_role_list` / `allow_start_user_list` — 各10件/ページ・`page`・◀▶",
          "`allow_start_*` / `remove_start_*` / 拒否チャンネルの追加・削除",
        ].join("\n"),
        inline: false,
      },
      {
        name:  "🚫 `/blacklist` （オーナー・管理者、または `/config` の ctrl で許可）",
        value: [
          "`add` / `remove` / `list`（10件/ページ）",
          "`config` — `/my-status` 照会の可否・サーバーBLの異議申し立てURL",
          "`config_show` — 上記の現在値を表示",
        ].join("\n"),
        inline: false,
      },
      // ── 基本コマンド ──────────────────────────
      {
        name:  "🎬 `/start #チャンネル [limit:数値]`",
        value: "OBSオーバーレイのセッションを開始します。\nDMにOBS用URLが送信されます。`limit` で同時表示上限を指定できます（1〜99999、デフォルト: 環境変数の MAX_COMMENTS）。",
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
        value: "CPU・メモリ使用率、稼働時間、バージョン、自分のアクティブセッション状況を表示します（グローバル BL 対象外なら誰でも実行可）。",
        inline: false,
      },
      // ── メタデータ書式 ──────────────────────────
      {
        name:  "🎨 メタデータ書式 `?属性 属性?`",
        value: [
          "メッセージ内の `?` と `?` の間に属性を指定します。",
          "**テキストのどこに書いても認識されます。**",
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
          "`ue`（上固定・5秒）/ `shita`（下固定・5秒）",
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
      // ── 絵文字・スタンプ ──────────────────────
      {
        name:  "😀 絵文字・スタンプ",
        value: [
          "サーバーのカスタム絵文字はOBSにインライン画像として表示されます。",
          "絵文字のサイズはテキストのフォントサイズに連動します。",
          "**スタンプはOBSのオーバーレイにのみ表示されます（Discordのチャット欄には表示されません）。**",
        ].join("\n"),
        inline: false,
      },
      // ── 記述例 ────────────────────────────────
      {
        name:  "💡 記述例",
        value: [
          "`?red ue? お知らせ` → 赤色・上固定",
          "`?blue big? **重要** テキスト` → 青色・大文字・太字・流れる",
          "`テキスト ?shita green?` → 緑色・下固定（末尾でもOK）",
          "`?#ff8800 big ue? カスタムカラー` → HEX指定・大文字・上固定",
        ].join("\n"),
        inline: false,
      },
      // ── 認証フロー ────────────────────────────
      {
        name:  "📌 認証フロー",
        value: [
          "1. `/start #チャンネル` でURLを取得（DMに送信されます）",
          "2. OBSのブラウザソースにURLを貼り付け",
          "3. 画面に表示された6桁コードを確認",
          "4. `/auth [コード]` で認証完了",
        ].join("\n"),
        inline: false,
      },
    )
    .setFooter({ text: `v${VERSION} | コメントは文字数が多いほど速く流れます` })
    .setTimestamp();

  return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
}