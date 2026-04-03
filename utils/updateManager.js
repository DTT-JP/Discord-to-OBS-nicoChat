/**
 * Bot 更新（git pull + 再起動/再読み込み）中の排他制御を管理します。
 *
 * - 更新コマンド実行〜更新が完了するまで、他のスラッシュコマンドを無効化します
 * - 更新コマンド自体は別枠で制御します（ここでは状態のみ管理）
 */

let job = null;

/**
 * @returns {boolean}
 */
export function isUpdateInProgress() {
  return job != null;
}

/**
 * @returns {{ startedAt: number, initiatedById: string | null, action: string | null } | null}
 */
export function getUpdateJobInfo() {
  return job
    ? {
      startedAt: job.startedAt,
      initiatedById: job.initiatedById,
      action: job.action ?? null,
    }
    : null;
}

/**
 * 更新ジョブを開始します。すでに開始済みなら false します。
 * @param {{ initiatedById?: string, action?: string }} opts
 * @returns {boolean}
 */
export function tryStartUpdateJob(opts = {}) {
  if (job) return false;
  job = {
    startedAt: Date.now(),
    initiatedById: opts.initiatedById ?? null,
    action: opts.action ?? null,
  };
  return true;
}

/**
 * 更新ジョブを終了します（ロック解除）。
 */
export function finishUpdateJob() {
  job = null;
}

