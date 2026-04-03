import {
  SlashCommandBuilder,
  EmbedBuilder,
  MessageFlags,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  StringSelectMenuBuilder,
} from "discord.js";
import { VERSION } from "../utils/version.js";

const HELP_PREFIX = "helpnav";

const HELP_SECTIONS = [
  {
    id:    "setup",
    label: "セットアップ / 管理者向け",
    title: "📖 ヘルプ — セットアップ",
  },
  {
    id:    "update",
    label: "運用 / 更新",
    title: "📖 ヘルプ — 運用 / 更新",
  },
  {
    id:    "basic",
    label: "基本コマンド",
    title: "📖 ヘルプ — 基本コマンド",
  },
  {
    id:    "meta",
    label: "メタデータ / 装飾",
    title: "📖 ヘルプ — メタデータ / 装飾",
  },
  {
    id:    "emoji",
    label: "絵文字・記述例",
    title: "📖 ヘルプ — 絵文字・記述例",
  },
  {
    id:    "authflow",
    label: "認証フロー",
    title: "📖 ヘルプ — 認証フロー",
  },
];

function buildHelpEmbed(sectionId) {
  const base = new EmbedBuilder()
    .setColor(0x5865f2)
    .setDescription("Discordのメッセージをリアルタイムでニコニコ風にOBSへ配信するBotです。")
    .setFooter({ text: `v${VERSION} | コメントは文字数が多いほど速く流れます` })
    .setTimestamp();

  switch (sectionId) {
    case "setup":
      base
        .setTitle("📖 Discord OBS Overlay — セットアップ")
        .setFields(
          {
            name:  "🔧 `/config` （サーバーオーナー・管理者のみ）",
            value: [
              "`/setup` 実行許可: `add_setup_role` / `remove_setup_role` / `add_setup_user` / `remove_setup_user`",
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
              "`allow_start_*` / `remove_start_*` / `add_deny_channel` / `remove_deny_channel`",
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
        );
      break;

    case "update":
      base
        .setTitle("📖 Discord OBS Overlay — 運用 / 更新")
        .setFields(
          {
            name: "🔁 `/bot-update`（BOT管理者のみ）",
            value: [
              "実行すると `git` で更新し、`pm2` の `restart` / `reload` で反映します。",
              "",
              "引数:",
              "・`mode`: `restart`（`pm2 restart`） / `reload`（`pm2 reload`）",
              "・`delay_minutes`: 更新開始までの待機時間（分、0=即時）",
              "",
              "注意:",
              "・更新中は他のスラッシュコマンドを無効化します。",
              "・`UPDATE_PM2_APP`（.env）を設定していない場合、`pm2` で反映できません。",
              "・更新前後で `.env.example` が異なる場合、`.env` を手動反映してから `/bot-update` を再実行してください（再起動/再読み込みはスキップされます）。",
            ].join("\n"),
            inline: false,
          },
        );
      break;

    case "basic":
      base
        .setTitle("📖 Discord OBS Overlay — 基本コマンド")
        .setFields(
          {
            name:  "🎬 `/start #チャンネル [limit:数値]`",
            value:
              "OBSオーバーレイのセッションを開始します。\nDMにOBS用URLが送信されます。`limit` で同時表示上限を指定できます（1〜99999、デフォルト: 環境変数の MAX_COMMENTS）。",
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
            value:
              "CPU・メモリ使用率、稼働時間、バージョン、自分のアクティブセッション状況を表示します（グローバル BL 対象外なら誰でも実行可）。",
            inline: false,
          },
        );
      break;

    case "meta":
      base
        .setTitle("📖 Discord OBS Overlay — メタデータ / 装飾")
        .setFields(
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
          {
            name:  "✏️ Discord書式によるテキスト装飾",
            value: [
              "`**太字**` `*斜体*` `__下線__` `~~取り消し線~~`",
              "改行（Shift+Enter）→ 複数行表示・AA対応",
            ].join("\n"),
            inline: false,
          },
        );
      break;

    case "emoji":
      base
        .setTitle("📖 Discord OBS Overlay — 絵文字・記述例")
        .setFields(
          {
            name:  "😀 絵文字・スタンプ",
            value: [
              "サーバーのカスタム絵文字はOBSにインライン画像として表示されます。",
              "絵文字のサイズはテキストのフォントサイズに連動します。",
              "**スタンプはOBSのオーバーレイにのみ表示されます（Discordのチャット欄には表示されません）。**",
            ].join("\n"),
            inline: false,
          },
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
        );
      break;

    case "authflow":
    default:
      base
        .setTitle("📖 Discord OBS Overlay — 認証フロー")
        .setFields({
          name:  "📌 認証フロー",
          value: [
            "1. `/start #チャンネル` でURLを取得（DMに送信されます）",
            "2. OBSのブラウザソースにURLを貼り付け",
            "3. 画面に表示された6桁コードを確認",
            "4. `/auth [コード]` で認証完了",
          ].join("\n"),
          inline: false,
        });
      break;
  }

  return base;
}

function buildHelpComponents(userId, sectionIndex) {
  const total = HELP_SECTIONS.length;
  const prevIndex = Math.max(0, sectionIndex - 1);
  const nextIndex = Math.min(total - 1, sectionIndex + 1);

  const arrows = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}:${userId}:${prevIndex}`)
      .setLabel("◀ 前の項目")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sectionIndex === 0),
    new ButtonBuilder()
      .setCustomId(`${HELP_PREFIX}:${userId}:${nextIndex}`)
      .setLabel("次の項目 ▶")
      .setStyle(ButtonStyle.Secondary)
      .setDisabled(sectionIndex === total - 1),
  );

  const select = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${HELP_PREFIX}:jump:${userId}`)
      .setPlaceholder("表示したい項目を選択…")
      .addOptions(
        HELP_SECTIONS.map((s, idx) => ({
          label: s.label,
          value: s.id,
          description: s.title.replace("📖 Discord OBS Overlay — ", ""),
          default: idx === sectionIndex,
        })),
      ),
  );

  return [arrows, select];
}

export const data = new SlashCommandBuilder()
  .setName("help")
  .setDescription("コマンド一覧と使い方を表示します")
  .addStringOption((option) =>
    option
      .setName("section")
      .setDescription("最初に表示するヘルプ項目")
      .addChoices(
        { name: "セットアップ / 管理者向け", value: "setup" },
        { name: "運用 / 更新", value: "update" },
        { name: "基本コマンド", value: "basic" },
        { name: "メタデータ / 装飾", value: "meta" },
        { name: "絵文字・記述例", value: "emoji" },
        { name: "認証フロー", value: "authflow" },
      ),
  );

export async function execute(interaction) {
  const requested = interaction.options.getString("section", false);
  const defaultIndex = HELP_SECTIONS.findIndex((s) => s.id === (requested ?? ""));
  const sectionIndex = defaultIndex >= 0 ? defaultIndex : 0;
  const section = HELP_SECTIONS[sectionIndex];

  const embed = buildHelpEmbed(section.id);
  const components = buildHelpComponents(interaction.user.id, sectionIndex);

  return interaction.reply({ embeds: [embed], components, flags: MessageFlags.Ephemeral });
}

export function isHelpComponentInteraction(interaction) {
  if (interaction.isButton()) {
    return interaction.customId.startsWith(HELP_PREFIX + ":");
  }
  if (interaction.isStringSelectMenu()) {
    return interaction.customId.startsWith(HELP_PREFIX + ":jump:");
  }
  return false;
}

export async function handleHelpComponent(interaction) {
  if (interaction.isButton()) {
    const parts = interaction.customId.split(":");
    if (parts.length !== 3 || parts[0] !== HELP_PREFIX) return;
    const [, ownerId, indexStr] = parts;
    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "❌ このヘルプの操作は、ヘルプを開いたユーザーだけが行えます。",
        flags: MessageFlags.Ephemeral,
      });
    }
    const index = Number.parseInt(indexStr, 10);
    if (!Number.isFinite(index)) return;
    const clamped = Math.min(Math.max(0, index), HELP_SECTIONS.length - 1);
    const section = HELP_SECTIONS[clamped];
    const embed = buildHelpEmbed(section.id);
    const components = buildHelpComponents(ownerId, clamped);

    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [embed], components });
    return;
  }

  if (interaction.isStringSelectMenu()) {
    const parts = interaction.customId.split(":");
    if (parts.length !== 3 || parts[0] !== HELP_PREFIX || parts[1] !== "jump") return;
    const [, , ownerId] = parts;
    if (interaction.user.id !== ownerId) {
      return interaction.reply({
        content: "❌ このヘルプの操作は、ヘルプを開いたユーザーだけが行えます。",
        flags: MessageFlags.Ephemeral,
      });
    }
    const value = interaction.values[0];
    const index = HELP_SECTIONS.findIndex((s) => s.id === value);
    const clamped = index >= 0 ? index : 0;
    const section = HELP_SECTIONS[clamped];
    const embed = buildHelpEmbed(section.id);
    const components = buildHelpComponents(ownerId, clamped);

    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [embed], components });
  }
}