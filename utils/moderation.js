export function isAdminOrOwner(interaction) {
  if (!interaction.guild) return false;
  if (interaction.user.id === interaction.guild.ownerId) return true;
  return interaction.memberPermissions?.has("Administrator") ?? false;
}

export function parseTargetUser(interaction, userOption = "user", idOption = "user_id") {
  const user = interaction.options.getUser(userOption, false);
  const rawId = interaction.options.getString(idOption, false)?.trim() ?? "";

  if (user && rawId && user.id !== rawId) {
    return {
      error: "❌ `user`（@メンション）と `user_id` が別のユーザーになっています。どちらか一方だけ指定してください。",
    };
  }

  const userId = user?.id ?? rawId;
  if (!userId) {
    return { error: "❌ `user`（@メンション）または `user_id`（17〜20桁の数字）のどちらかを指定してください。" };
  }
  if (!/^\d{17,20}$/.test(userId)) {
    return {
      error: "❌ ユーザーIDの形式が正しくありません（17〜20桁の数字）。または `@ユーザー` で指定してください。",
    };
  }

  return { user, userId };
}

/**
 * 応答メッセージ用の表示名（メンション無しでも API で解決を試みる）
 * @param {import("discord.js").Client} client
 * @param {{ user?: import("discord.js").User | null, userId: string }} target
 */
export async function formatUserTagForReply(client, target) {
  if (target.user) return target.user.tag;
  try {
    const u = await client.users.fetch(target.userId);
    return u.tag;
  } catch {
    return `\`${target.userId}\``;
  }
}

export function computeExpireAt(durationType, durationValue) {
  if (durationType === "unlimited") return null;
  const now = new Date();
  const amount = Number(durationValue ?? 0);
  if (!Number.isFinite(amount) || amount <= 0) return null;

  const mapMs = {
    minute: 60 * 1000,
    hour: 60 * 60 * 1000,
    day: 24 * 60 * 60 * 1000,
    week: 7 * 24 * 60 * 60 * 1000,
    month: 30 * 24 * 60 * 60 * 1000,
  };
  if (durationType in mapMs) return Date.now() + amount * mapMs[durationType];

  if (durationType === "year") {
    const future = new Date(now);
    future.setFullYear(now.getFullYear() + amount);
    return future.getTime();
  }
  return null;
}

export function formatRemaining(expiresAt) {
  if (expiresAt == null) return "無制限";
  const diff = expiresAt - Date.now();
  if (diff <= 0) return "期限切れ";
  const totalMinutes = Math.floor(diff / 60000);
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  const parts = [];
  if (days) parts.push(`${days}日`);
  if (hours) parts.push(`${hours}時間`);
  if (minutes || parts.length === 0) parts.push(`${minutes}分`);
  return parts.join(" ");
}

export function truncateReason(reason) {
  if (!reason) return "(理由なし)";
  return reason.length > 30 ? `${reason.slice(0, 30)}…` : reason;
}

export function formatDateTime(value) {
  if (value == null) return "無制限";
  return new Date(value).toLocaleString("ja-JP", { hour12: false });
}
