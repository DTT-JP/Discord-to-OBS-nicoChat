/**
 * BOTオーナー判定を集約する。
 *
 * BOT_OWNER_ID はカンマ区切り・空白区切りで複数指定できる。
 */
export function getBotOwnerIds() {
  return (process.env.BOT_OWNER_ID ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter(Boolean);
}

export function hasBotOwnerConfigured() {
  return getBotOwnerIds().length > 0;
}

export function isBotOwnerUserId(userId) {
  return !!userId && getBotOwnerIds().includes(userId);
}

export function isBotOwnerInteraction(interaction) {
  return isBotOwnerUserId(interaction.user?.id);
}
