// `publish` —— 产出给个人网站用的聚合 JSON。
//
// 这是**整个项目里唯一会把数据写出去的地方**，所以几条约束是硬的：
//
//  1. **只发聚合数字**：每日总额 + 按模型。**不含项目名、路径、prompt。**
//     不是"过滤掉"，而是输出结构里根本没有这些字段——没有的东西泄不出去。
//     项目维度在这里是刻意不取的，即使 `buildReport()` 能算出来。
//
//  2. **整份重写，不做增量 upsert**。重新聚合本机全部日志得到所有 UTC+8 日，
//     整文件覆盖。好处是**回填天然发生**：机器关机三天后开机补跑，那三天的
//     数据自动就在结果里，不需要单独的补漏逻辑。
//
//  3. **与系统时区无关**（见 report/aggregate.js 的时区说明）。
//
//  4. **今天是部分的**。发布时当天还没过完，所以那一条的数字还会长。这是正确的
//     ——网站上"今日"本就该是实时值。次日跑时它会自动变成完整值。

import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { collect, localHostname } from './collect.js';
import { loadPrices, costOfBucket } from './pricing/cost.js';
import { dayKey, todayKey } from './report/aggregate.js';

export const SCHEMA_VERSION = 2;
/** 保留天数上限。超出会裁剪，否则文件随使用年限无限增长。 */
export const RETENTION_DAYS = Number(process.env.CONTRAIL_RETENTION_DAYS ?? 400);

/** 成本保留 4 位小数，避免浮点尾数让输出在两次运行间抖动。 */
const round4 = (v) => Math.round(v * 1e4) / 1e4;

/** 发布出去的 token 列。顺序即输出顺序，也是页面与校验器共用的口径。 */
export const TOKEN_FIELDS = ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite'];

/** bucket 的上游字段 → 发布字段。六列互不重叠，两种 cache write 合并成一列。 */
function tokenColumns(b) {
  return {
    input: b.inputTokens ?? 0,
    output: b.outputTokens ?? 0,
    reasoning: b.reasoningOutputTokens ?? 0,
    cacheRead: b.cachedInputTokens ?? 0,
    cacheWrite: (b.cacheCreation5mTokens ?? 0) + (b.cacheCreation1hTokens ?? 0),
  };
}

const zeroColumns = () => ({ input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });

function addColumns(into, cols) {
  for (const k of TOKEN_FIELDS) into[k] += cols[k];
}

/**
 * 汇总字段。`tokens` 沿用上游 bucket 的 totalTokens 口径（**不含 cache read**），
 * `tokensInclCache` 是实际处理量——只报前者会让人以为自己用少了一个数量级。
 */
function withTotals(cols) {
  const tokens = cols.input + cols.output + cols.reasoning + cols.cacheWrite;
  return { tokens, tokensInclCache: tokens + cols.cacheRead };
}

/**
 * 把 buckets 聚合成发布用的结构。**纯函数**，便于测试。
 *
 * v2 相对 v1 的变化：每天从「按模型」改成「按 (工具, 模型)」的扁平 `rows`，
 * 并拆出五个 token 列——这是 dashboard 的按工具/按模型/token 构成视图的最小充分
 * 粒度。另加两个**纯计数**：当日开始的会话数（conversations）与用户提问轮数（turns）。
 *
 * 字段名刻意避开 session / prompt / message：校验器的隐私守卫按词根拒绝这些键名，
 * 那条守卫要保持严格，所以是这里让路。
 *
 * 依然只有数字、工具名、模型名。项目、路径、会话 id 在这里**不被读取**。
 *
 * @param {object[]} buckets
 * @param {object} prices
 * @param {{host:string, now?:Date, retentionDays?:number, sessions?:object[]}} opts
 */
export function buildPayload(buckets, prices, { host, now = new Date(), retentionDays = RETENTION_DAYS, sessions = [] } = {}) {
  const today = todayKey(now);
  const cutoff = cutoffKey(today, retentionDays);
  const byDay = new Map();
  const unpriced = new Set();

  const dayEntry = (d) => {
    let entry = byDay.get(d);
    if (!entry) {
      entry = { date: d, cost: 0, cols: zeroColumns(), conversations: 0, turns: 0, _rows: new Map() };
      byDay.set(d, entry);
    }
    return entry;
  };

  for (const b of buckets) {
    const d = dayKey(b.bucketStart);
    if (!d) continue;
    const r = costOfBucket(b, prices);
    if (!r.priced) unpriced.add(b.model);
    const cols = tokenColumns(b);

    const entry = dayEntry(d);
    entry.cost += r.cost;
    addColumns(entry.cols, cols);

    const key = `${b.source}\u0000${b.model}`;
    let row = entry._rows.get(key);
    if (!row) {
      row = { source: b.source, model: b.model, cost: 0, cols: zeroColumns() };
      entry._rows.set(key, row);
    }
    row.cost += r.cost;
    addColumns(row.cols, cols);
  }

  // 会话只取两个计数，按会话**开始**的那天归属。
  for (const s of sessions) {
    const d = dayKey(s.firstMessageAt);
    if (!d) continue;
    const entry = dayEntry(d);
    entry.conversations += 1;
    entry.turns += Number.isFinite(s.userMessageCount) ? s.userMessageCount : 0;
  }

  // 裁剪 + 排序 + 定型。顺序全部固定，保证同样的输入产出同样的字节。
  const days = [...byDay.values()]
    .filter((e) => e.date >= cutoff)
    .sort((a, b) => (a.date < b.date ? -1 : 1))
    .map((e) => ({
      date: e.date,
      cost: round4(e.cost),
      ...e.cols,
      ...withTotals(e.cols),
      conversations: e.conversations,
      turns: e.turns,
      // 按成本降序、同成本按 tokens 降序、再按 (工具, 模型) 升序 —— 让输出可复现
      rows: [...e._rows.values()]
        .map((r) => ({ source: r.source, model: r.model, cost: round4(r.cost), ...r.cols, ...withTotals(r.cols) }))
        .filter((r) => r.tokensInclCache > 0 || r.cost > 0)
        .sort((a, b) => (b.cost - a.cost) || (b.tokensInclCache - a.tokensInclCache)
          || (a.source < b.source ? -1 : a.source > b.source ? 1 : 0)
          || (a.model < b.model ? -1 : a.model > b.model ? 1 : 0)),
    }));

  return finalizePayload(days, { host, now, unpricedModels: [...unpriced] });
}

/**
 * 由逐日数据组装完整的发布结构（顶层汇总 + 元数据）。
 * 让页面直接读汇总，不用自己遍历累加 —— 也保证「总量」的定义只有一处。
 */
function finalizePayload(days, { host, now, unpricedModels }) {
  const cols = zeroColumns();
  let cost = 0;
  let conversations = 0;
  let turns = 0;
  for (const d of days) {
    addColumns(cols, d);
    cost += d.cost;
    conversations += d.conversations;
    turns += d.turns;
  }

  return {
    host,
    schemaVersion: SCHEMA_VERSION,
    updatedAt: new Date(now.getTime()).toISOString().replace(/\.\d{3}Z$/, 'Z'),
    timezone: 'UTC+8',
    totals: {
      cost: round4(cost),
      ...cols,
      ...withTotals(cols),
      conversations,
      turns,
      days: days.length,
      // 没有数据时**省略**而不是写 null —— 校验器的隐私守卫明确拒绝 null。
      ...(days.length > 0 ? { firstDate: days[0].date, lastDate: days[days.length - 1].date } : {}),
    },
    // 查不到价的模型按 $0 计。公开出来是为了让页面标明「花费是下界」，
    // 而不是让一个漏配的模型静默吞掉一块花费。
    unpricedModels: [...new Set(unpricedModels)].sort(),
    days,
  };
}

/**
 * 与上一次发布的文件按天合并：**已经发布过的历史不因日志被清理而消失**。
 *
 * 为什么需要：发布是按「现存日志」整份重算的，而 Claude Code 默认只保留 30 天
 * 会话记录。不合并的话，日志一被清理，网站上那几天的数字就跟着归零——这在
 * 2026-09 实测发生过：DeepSeek 平台记账 330 亿 token，本地日志只剩一成。
 *
 * 规则（逐日）：
 *   - 新算出的这一天**不存在**，或 tokensInclCache **比上次发布的小** → 保留上次的
 *     整天记录。日志只会因清理而变少，同一天的真实用量不会减少。
 *   - 其余情况用新值（当天还在增长、新出现的日子）。
 * 整天取舍而不是逐行取 max：逐行混拼会得到一天里「一半旧一半新」的数字，
 * 各列之间对不上。
 *
 * 代价：如果某次 parser 修复让某天的数字**合理地**变小（比如修掉重复计数），
 * 合并会把旧的大数字保留下来。这时用 `publish --rebuild` 显式重建。
 *
 * **纯函数**。`previous` 为 null 或版本不符时原样返回 `next`。
 */
export function mergeWithPrevious(previous, next, { now = new Date(), retentionDays = RETENTION_DAYS } = {}) {
  if (!previous || previous.schemaVersion !== next.schemaVersion || previous.host !== next.host) return next;

  const cutoff = cutoffKey(todayKey(now), retentionDays);
  const byDate = new Map(next.days.map((d) => [d.date, d]));
  const kept = [];
  for (const old of previous.days ?? []) {
    if (old.date < cutoff) continue;
    const fresh = byDate.get(old.date);
    if (!fresh || fresh.tokensInclCache < old.tokensInclCache) {
      byDate.set(old.date, old);
      kept.push(old);
    }
  }
  if (!kept.length) return next;

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1));
  // 保留下来的旧日子里若有当时无价的模型，提醒也要一并保留
  const keptModels = new Set(kept.flatMap((d) => d.rows.map((r) => r.model)));
  const unpricedModels = [
    ...next.unpricedModels,
    ...(previous.unpricedModels ?? []).filter((m) => keptModels.has(m)),
  ];
  return finalizePayload(days, { host: next.host, now, unpricedModels });
}

/** 保留窗口的左边界日键。 */
function cutoffKey(today, retentionDays) {
  const [y, m, d] = today.split('-').map(Number);
  const back = new Date(Date.UTC(y, m - 1, d - (retentionDays - 1)));
  return back.toISOString().slice(0, 10);
}

/** 稳定序列化：2 空格缩进 + 末尾换行。字节可复现。 */
export function serialize(payload) {
  return JSON.stringify(payload, null, 2) + '\n';
}

/**
 * 内容没变就不写盘。
 *
 * 抽成独立函数是为了能被测试覆盖——它嵌在 `publish()` 里时，要触发这个分支就得
 * 跑一次完整的日志解析（数秒），而日志又在持续变化，测试既慢又脆。
 *
 * 不写的好处不只是省一次磁盘写：**文件的 mtime 就成了"数据有没有变"的信号**，
 * 从而能用 `git diff --quiet` 判断该不该产生一次提交。
 *
 * @returns {boolean} 是否真的写了
 */
export function writeIfChanged(outPath, text) {
  if (existsSync(outPath)) {
    try {
      if (readFileSync(outPath, 'utf8') === text) return false;
    } catch {
      // 读不了就当作有变化，正常写一遍
    }
  }
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text, { encoding: 'utf8' });
  return true;
}

/**
 * 采集本机日志并写出发布文件。
 *
 * @returns {{path:string, payload:object, written:boolean, unchanged:boolean}}
 */
export async function publish({
  outPath,
  host = localHostname(),
  now = new Date(),
  extraRoots = {},
  codexExtraHome,
  rebuild = false,
} = {}) {
  const prices = loadPrices();
  const { buckets, sessions } = await collect({ hostname: host, extraRoots, codexExtraHome });
  const fresh = buildPayload(buckets, prices, { host, now, sessions });
  const payload = rebuild ? fresh : mergeWithPrevious(readPrevious(outPath), fresh, { now });
  const written = writeIfChanged(outPath, serialize(payload));
  return { path: outPath, payload, written, unchanged: !written };
}

/** 上一次发布的文件；不存在或读不了时为 null（等同首次发布）。 */
function readPrevious(outPath) {
  if (!existsSync(outPath)) return null;
  try {
    return JSON.parse(readFileSync(outPath, 'utf8'));
  } catch {
    return null;
  }
}

/** 默认输出路径：`<repo>/data/<host>.json`。 */
export function defaultOutPath(repoRoot, host = localHostname()) {
  return join(repoRoot, 'data', `${host}.json`);
}
