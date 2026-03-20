import { cpus, freemem, totalmem } from "node:os";

// ─────────────────────────────────────────────
// CPU 使用率
// ─────────────────────────────────────────────

/**
 * 各 CPU コアの times スナップショットを取得する
 * @returns {{ idle: number, total: number }[]}
 */
function getCpuTimes() {
  return cpus().map((core) => {
    const t = core.times;
    const total = t.user + t.nice + t.sys + t.idle + t.irq;
    return { idle: t.idle, total };
  });
}

/**
 * 2回のスナップショット間の平均 CPU 使用率を返す
 * @param {number} [intervalMs=500] - 計測間隔（ms）
 * @returns {Promise<number>} 0〜100 の使用率（小数点2桁）
 */
export function getCpuUsage(intervalMs = 500) {
  return new Promise((resolve) => {
    const before = getCpuTimes();

    setTimeout(() => {
      const after = getCpuTimes();

      let idleDiff  = 0;
      let totalDiff = 0;

      for (let i = 0; i < before.length; i++) {
        idleDiff  += after[i].idle  - before[i].idle;
        totalDiff += after[i].total - before[i].total;
      }

      const usage = totalDiff === 0
        ? 0
        : ((totalDiff - idleDiff) / totalDiff) * 100;

      resolve(Math.round(usage * 100) / 100);
    }, intervalMs);
  });
}

// ─────────────────────────────────────────────
// メモリ使用量
// ─────────────────────────────────────────────

/**
 * @typedef {Object} MemoryInfo
 * @property {number} rss         - プロセスの RSS メモリ（MB）
 * @property {number} heapUsed    - V8 ヒープ使用量（MB）
 * @property {number} heapTotal   - V8 ヒープ合計（MB）
 * @property {number} systemFree  - OS 空きメモリ（MB）
 * @property {number} systemTotal - OS 総メモリ（MB）
 * @property {number} systemUsage - OS メモリ使用率（%）
 */

/**
 * プロセスおよびシステムのメモリ情報を返す
 * @returns {MemoryInfo}
 */
export function getMemoryInfo() {
  const mem       = process.memoryUsage();
  const sysFree   = freemem();
  const sysTotal  = totalmem();

  const toMB = (bytes) => Math.round((bytes / 1024 / 1024) * 100) / 100;

  return {
    rss:         toMB(mem.rss),
    heapUsed:    toMB(mem.heapUsed),
    heapTotal:   toMB(mem.heapTotal),
    systemFree:  toMB(sysFree),
    systemTotal: toMB(sysTotal),
    systemUsage: Math.round(((sysTotal - sysFree) / sysTotal) * 10000) / 100,
  };
}

// ─────────────────────────────────────────────
// 統合スナップショット
// ─────────────────────────────────────────────

/**
 * @typedef {Object} SystemSnapshot
 * @property {number}     cpuUsage   - CPU 使用率（%）
 * @property {MemoryInfo} memory     - メモリ情報
 * @property {number}     uptime     - プロセス起動からの秒数
 */

/**
 * CPU・メモリ・稼働時間をまとめて返す
 * @param {number} [intervalMs=500]
 * @returns {Promise<SystemSnapshot>}
 */
export async function getSystemSnapshot(intervalMs = 500) {
  const [cpuUsage, memory] = await Promise.all([
    getCpuUsage(intervalMs),
    Promise.resolve(getMemoryInfo()),
  ]);

  return {
    cpuUsage,
    memory,
    uptime: Math.floor(process.uptime()),
  };
}