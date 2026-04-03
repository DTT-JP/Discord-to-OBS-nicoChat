import { SlashCommandBuilder, MessageFlags } from "discord.js";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readdirSync, promises as fs } from "node:fs";
import { execFile } from "node:child_process";
import { config as dotenvConfig } from "dotenv";
import { isAdminOrOwner } from "../utils/moderation.js";
import { isUpdateInProgress, tryStartUpdateJob, finishUpdateJob } from "../utils/updateManager.js";

function normalizeNewlines(text) {
  return text.replace(/\r\n/g, "\n").trimEnd();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getRepoRootFromThisModule() {
  // commands/*.js -> repo root
  const __dirname = dirname(fileURLToPath(import.meta.url));
  return join(__dirname, "..");
}

function setDefaultPresence(client) {
  client.user?.setPresence({
    activities: [{ name: "/help でコマンド一覧" }],
    status: "online",
  });
}

function setUpdatingPresence(client, activityName) {
  client.user?.setPresence({
    activities: [{ name: activityName }],
    status: "dnd",
  });
}

function runCommand(cmd, args, { cwd } = {}) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, windowsHide: true }, (err, stdout, stderr) => {
      if (err) {
        const details = (stderr || stdout || err.message || "").toString().trim();
        return reject(new Error(details || `command failed: ${cmd} ${args.join(" ")}`));
      }
      resolve({
        stdout: stdout?.toString() ?? "",
        stderr: stderr?.toString() ?? "",
      });
    });
  });
}

function getPm2App() {
  return (process.env.UPDATE_PM2_APP || "").trim();
}

async function runPm2(action) {
  const app = getPm2App();
  if (!app) {
    throw new Error("UPDATE_PM2_APP が .env に設定されていません。PM2 のアプリ名（または ID）を指定してください。");
  }

  const extraArgs = (process.env.UPDATE_PM2_EXTRA_ARGS || "")
    .split(/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  // --update-env が効かない/許可されていない環境があるため、まず試してダメなら外す
  const argsWithUpdate = [action, app, "--update-env", ...extraArgs];
  try {
    await runCommand("pm2", argsWithUpdate);
    return { usedUpdateEnv: true };
  } catch {
    const argsWithoutUpdate = [action, app, ...extraArgs];
    await runCommand("pm2", argsWithoutUpdate);
    return { usedUpdateEnv: false };
  }
}

async function reloadCommandsInMemory(client, repoRoot) {
  const commandsPath = join(repoRoot, "commands");
  const commandFiles = readdirSync(commandsPath).filter((f) => f.endsWith(".js"));

  client.commands.clear();

  for (const file of commandFiles) {
    const fileUrl = pathToFileURL(join(commandsPath, file)).href;
    const mod = await import(`${fileUrl}?cacheBust=${Date.now()}_${Math.random()}`);

    if (!mod.data?.name || typeof mod.execute !== "function") continue;
    client.commands.set(mod.data.name, mod);
  }
}

async function gitUpdateAndCheckEnvExample({ repoRoot }) {
  const envExamplePath = join(repoRoot, ".env.example");

  const beforeEnvExampleRaw = await fs.readFile(envExamplePath, "utf8");
  const beforeEnvExample = normalizeNewlines(beforeEnvExampleRaw);

  const beforeSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();

  const remoteName = (process.env.UPDATE_GIT_REMOTE_NAME || "origin").trim() || "origin";
  const remoteUrl = (process.env.UPDATE_GIT_REPO_URL || "").trim();
  const branchFromEnv = (process.env.UPDATE_GIT_BRANCH || "").trim();

  if (remoteUrl) {
    // remote が無ければ追加、あれば置換
    try {
      await runCommand("git", ["remote", "get-url", remoteName], { cwd: repoRoot });
      await runCommand("git", ["remote", "set-url", remoteName, remoteUrl], { cwd: repoRoot });
    } catch {
      await runCommand("git", ["remote", "add", remoteName, remoteUrl], { cwd: repoRoot });
    }
  }

  const targetBranch = branchFromEnv || (await (async () => {
    const cur = (await runCommand("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd: repoRoot })).stdout.trim();
    if (cur && cur !== "HEAD") return cur;
    return "main";
  })());

  // 指定ブランチを fetch -> FETCH_HEAD へ強制リセット（コード更新を確実にする）
  await runCommand("git", ["fetch", "--prune", remoteName, targetBranch], { cwd: repoRoot });
  await runCommand("git", ["reset", "--hard", "FETCH_HEAD"], { cwd: repoRoot });

  const afterEnvExampleRaw = await fs.readFile(envExamplePath, "utf8");
  const afterEnvExample = normalizeNewlines(afterEnvExampleRaw);

  const afterSha = (await runCommand("git", ["rev-parse", "HEAD"], { cwd: repoRoot })).stdout.trim();

  return {
    beforeSha,
    afterSha,
    envExampleChanged: beforeEnvExample !== afterEnvExample,
  };
}

export const data = new SlashCommandBuilder()
  .setName("bot-update")
  .setDescription("Bot を更新（再起動 / 再読み込み）します")
  .addStringOption((opt) =>
    opt
      .setName("mode")
      .setDescription("更新後の反映方法")
      .setRequired(true)
      .addChoices(
        { name: "再起動", value: "restart" },
        { name: "再読み込み", value: "reload" },
      ),
  )
  .addIntegerOption((opt) =>
    opt
      .setName("delay_minutes")
      .setDescription("更新までの待機時間（分）")
      .setMinValue(0)
      .setMaxValue(120)
      .setRequired(false),
  );

/**
 * @param {import("discord.js").ChatInputCommandInteraction} interaction
 */
export async function execute(interaction) {
  const repoRoot = getRepoRootFromThisModule();

  // PM2 起動時の env と現在の .env がズレることがあるため、
  // /bot-update 実行時にだけ .env を明示パスで読み直して必要キーを補完します。
  dotenvConfig({ path: join(repoRoot, ".env"), override: false });

  if (!interaction.guild) {
    return interaction.reply({
      content: "❌ このコマンドはサーバー内でのみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const botOwnerId = process.env.BOT_OWNER_ID?.trim();
  const isBotOwnerUser = !!botOwnerId && interaction.user?.id === botOwnerId;
  const isAllowed = isBotOwnerUser || isAdminOrOwner(interaction);
  if (!isAllowed) {
    return interaction.reply({
      content: "❌ このコマンドは BOT管理者のみ実行できます。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const mode = interaction.options.getString("mode", true);
  const delayMinutes = interaction.options.getInteger("delay_minutes", false) ?? 0;

  if (isUpdateInProgress()) {
    return interaction.reply({
      content: "⚠️ すでに更新処理が実行中のため、この操作はできません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  if (!tryStartUpdateJob({ initiatedById: interaction.user.id, action: mode })) {
    return interaction.reply({
      content: "⚠️ すでに更新処理が実行中のため、この操作はできません。",
      flags: MessageFlags.Ephemeral,
    });
  }

  const activityName = (process.env.UPDATE_ACTIVITY_NAME || "").trim() || "更新中...";

  try {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    setUpdatingPresence(interaction.client, activityName);

    if (delayMinutes > 0) {
      await interaction.editReply({
        content: `🕒 ${delayMinutes} 分後に更新を開始します（更新中のため他のコマンドは利用できません）。`,
      });
      await sleep(delayMinutes * 60 * 1000);
    } else {
      await interaction.editReply({
        content: "🔄 更新を開始します（更新中のため他のコマンドは利用できません）。",
      });
    }

    const result = await gitUpdateAndCheckEnvExample({ repoRoot });

    if (result.envExampleChanged) {
      const warning = [
        "⚠️ `.env.example` が更新されています。",
        "DiscordBOT以外の手段で `.env` を反映してから、このコマンドをもう一度実行してください（再起動/再読み込みはスキップされます）。",
      ].join("\n");

      await interaction.editReply({ content: warning });

      // BOTオーナーへも通告（呼び出しユーザーがオーナーなら重複を避ける）
      if (!isBotOwnerUser && botOwnerId) {
        try {
          const u = await interaction.client.users.fetch(botOwnerId);
          await u.send({ content: warning }).catch(() => {});
        } catch {
          // ignore
        }
      }

      setDefaultPresence(interaction.client);
      return;
    }

    const shaText = result.beforeSha && result.afterSha ? `\n- commit: ${result.beforeSha} -> ${result.afterSha}` : "";

    if (mode === "reload") {
      await interaction.editReply({ content: `✅ 更新完了しました。PM2 で再読み込みします。${shaText}` });
      setUpdatingPresence(interaction.client, "再読み込み中...");
      const pm2Res = await runPm2("reload");
      setDefaultPresence(interaction.client);
      await interaction.editReply({
        content: `✅ 更新完了（PM2 再読み込み）${shaText}\n- --update-env: ${pm2Res.usedUpdateEnv ? "使用" : "未使用"}`,
      });
      return;
    }

    await interaction.editReply({ content: `✅ 更新完了しました。PM2 で再起動します。${shaText}` });
    setUpdatingPresence(interaction.client, "再起動中...");
    const pm2Res = await runPm2("restart");
    setDefaultPresence(interaction.client);
    await interaction.editReply({
      content: `✅ 更新完了（PM2 再起動）${shaText}\n- --update-env: ${pm2Res.usedUpdateEnv ? "使用" : "未使用"}`,
    });
  } finally {
    setDefaultPresence(interaction.client);
    finishUpdateJob();
  }
}

