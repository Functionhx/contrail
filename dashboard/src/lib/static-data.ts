// Contrail 的数据层：把 `data/*.json`（contrail publish 产出的 v2 聚合）
// 转成上游 dashboard 组件期望的本地 API 响应形状。
//
// 上游的组件读的是 TokenTracker 本地服务 `/functions/tokentracker-usage-*`
// 的响应（见上游 src/lib/local-api.js）。这里在浏览器里按同样的字段名把
// 那些响应算出来，组件本身不用改。
//
// 数据来源只有同源的静态 JSON：页面不向任何第三方发请求（CSP 也会强制这一点）。

import { buildActivityHeatmap, computeActiveStreakDays, getHeatmapRangeLocal } from "./activity-heatmap";

type AnyRecord = Record<string, any>;

type Row = {
  source: string;
  model: string;
  cost: number;
  input: number;
  output: number;
  reasoning: number;
  cacheRead: number;
  cacheWrite: number;
  tokens: number;
  tokensInclCache: number;
};

type Day = {
  date: string;
  host: string;
  conversations: number;
  rows: Row[];
};

// 上游按 source 名找图标与显示名。我们的注册键是 claude-code，上游叫 claude。
const SOURCE_ALIASES: Record<string, string> = { "claude-code": "claude" };
const displaySource = (source: string) => SOURCE_ALIASES[source] || source;

const dataUrl = (name: string) => `${import.meta.env.BASE_URL}data/${name}`;

let loadPromise: Promise<Day[]> | null = null;

async function fetchJson(name: string) {
  const response = await fetch(dataUrl(name), { cache: "no-cache" });
  if (!response.ok) throw new Error(`Failed to load ${name}: HTTP ${response.status}`);
  return response.json();
}

/** 读取全部机器的数据并摊平成 (日, 机器) 列表。只加载一次。 */
export function loadDays(): Promise<Day[]> {
  if (!loadPromise) {
    loadPromise = (async () => {
      const hosts: string[] = await fetchJson("hosts.json");
      const files = await Promise.all(hosts.map((h) => fetchJson(`${h}.json`)));
      const days: Day[] = [];
      for (const file of files) {
        for (const d of file.days || []) {
          days.push({
            date: d.date,
            host: file.host,
            conversations: d.conversations || 0,
            rows: (d.rows || []).map((r: Row) => ({ ...r, source: displaySource(r.source) })),
          });
        }
      }
      return days;
    })();
    // 失败时允许下次重试，而不是把一次网络抖动永久缓存下来
    loadPromise.catch(() => {
      loadPromise = null;
    });
  }
  return loadPromise;
}

/** 数据里的最新更新时刻，供页面显示「更新于」。 */
export async function loadUpdatedAt(): Promise<string | null> {
  const hosts: string[] = await fetchJson("hosts.json");
  const files = await Promise.all(hosts.map((h) => fetchJson(`${h}.json`)));
  const stamps = files.map((f) => f.updatedAt).filter(Boolean).sort();
  return stamps.length ? stamps[stamps.length - 1] : null;
}

function emptyTotals(): AnyRecord {
  return {
    total_tokens: 0,
    billable_total_tokens: 0,
    total_cost_usd: 0,
    input_tokens: 0,
    output_tokens: 0,
    cached_input_tokens: 0,
    cache_creation_input_tokens: 0,
    reasoning_output_tokens: 0,
    conversation_count: 0,
  };
}

// total_tokens 与 billable_total_tokens 都取「含 cache 的实际处理量」：上游首屏
// 显示 billable_total_tokens，只报不含 cache 的数会低估一个数量级。
function addRow(into: AnyRecord, r: Row) {
  into.total_tokens += r.tokensInclCache;
  into.billable_total_tokens += r.tokensInclCache;
  into.total_cost_usd += r.cost;
  into.input_tokens += r.input;
  into.output_tokens += r.output;
  into.cached_input_tokens += r.cacheRead;
  into.cache_creation_input_tokens += r.cacheWrite;
  into.reasoning_output_tokens += r.reasoning;
}

type Filter = { source?: string; model?: string; device?: string };

function normalizeFilter({ source, model, device }: AnyRecord = {}): Filter {
  const s = typeof source === "string" ? source.trim().toLowerCase() : "";
  const m = typeof model === "string" ? model.trim() : "";
  const d = typeof device === "string" ? device.trim() : "";
  return { source: s || undefined, model: m || undefined, device: d || undefined };
}

function rowMatches(r: Row, f: Filter) {
  return (!f.source || r.source === f.source) && (!f.model || r.model === f.model);
}

/** 按日聚合，结构与上游 aggregateByDay 的输出一致。 */
function aggregateByDay(days: Day[], f: Filter) {
  const byDay = new Map<string, AnyRecord>();
  for (const d of days) {
    if (f.device && d.host !== f.device) continue;
    const rows = d.rows.filter((r) => rowMatches(r, f));
    // 会话数没有按工具拆分，只在未按工具/模型过滤时计入
    const conversations = f.source || f.model ? 0 : d.conversations;
    if (!rows.length && !conversations) continue;
    let entry = byDay.get(d.date);
    if (!entry) {
      entry = { day: d.date, ...emptyTotals(), models: {} };
      byDay.set(d.date, entry);
    }
    entry.conversation_count += conversations;
    for (const r of rows) {
      addRow(entry, r);
      entry.models[r.model] = (entry.models[r.model] || 0) + r.tokensInclCache;
    }
  }
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

const inRange = (day: string, from?: string, to?: string) =>
  (!from || day >= from) && (!to || day <= to);

function withCostString<T extends AnyRecord>(totals: T): T {
  return { ...totals, total_cost_usd: Number(totals.total_cost_usd || 0).toFixed(6) };
}

function shiftDay(day: string, delta: number) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}

function todayKey(timeZone?: string) {
  try {
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: timeZone || undefined,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date());
  } catch {
    return new Date().toISOString().slice(0, 10);
  }
}

export async function getStaticUsageDaily({ from, to, ...rest }: AnyRecord = {}) {
  const daily = aggregateByDay(await loadDays(), normalizeFilter(rest)).filter((d) => inRange(d.day, from, to));
  return { from, to, data: daily.map(withCostString) };
}

export async function getStaticUsageSummary({ from, to, timeZone, ...rest }: AnyRecord = {}) {
  const all = aggregateByDay(await loadDays(), normalizeFilter(rest));
  const daily = all.filter((d) => inRange(d.day, from, to));
  const totals = emptyTotals();
  for (const d of daily) {
    for (const k of Object.keys(totals)) totals[k] += d[k] || 0;
  }

  const today = todayKey(timeZone);
  const byDay = new Map(all.map((d) => [d.day, d]));
  const window = (n: number) => {
    const days: AnyRecord[] = [];
    for (let i = n - 1; i >= 0; i--) {
      const hit = byDay.get(shiftDay(today, -i));
      if (hit) days.push(hit);
    }
    const sum = days.reduce(
      (a, r) => ({
        billable_total_tokens: a.billable_total_tokens + r.billable_total_tokens,
        conversation_count: a.conversation_count + r.conversation_count,
      }),
      { billable_total_tokens: 0, conversation_count: 0 },
    );
    return { from: shiftDay(today, -(n - 1)), to: today, active_days: days.length, totals: sum };
  };
  const l30 = window(30);

  return {
    from,
    to,
    days: daily.length,
    totals: withCostString(totals),
    rolling: {
      last_7d: window(7),
      last_30d: {
        ...l30,
        avg_per_active_day: l30.active_days > 0 ? Math.round(l30.totals.billable_total_tokens / l30.active_days) : 0,
      },
    },
  };
}

export async function getStaticUsageMonthly({ months = 24, to, ...rest }: AnyRecord = {}) {
  const end = to || todayKey();
  const startDate = new Date(`${end.slice(0, 7)}-01T00:00:00Z`);
  startDate.setUTCMonth(startDate.getUTCMonth() - (Number(months) - 1));
  const from = startDate.toISOString().slice(0, 10);

  const byMonth = new Map<string, AnyRecord>();
  for (const d of aggregateByDay(await loadDays(), normalizeFilter(rest))) {
    if (!inRange(d.day, from, end)) continue;
    const month = d.day.slice(0, 7);
    let entry = byMonth.get(month);
    if (!entry) {
      entry = { month, ...emptyTotals(), models: {} };
      byMonth.set(month, entry);
    }
    for (const k of Object.keys(emptyTotals())) entry[k] += d[k] || 0;
    for (const [m, v] of Object.entries(d.models || {})) entry.models[m] = (entry.models[m] || 0) + Number(v);
  }
  const data = [...byMonth.values()].sort((a, b) => (a.month < b.month ? -1 : 1)).map(withCostString);
  return { from, to: end, months, data };
}

// 发布数据只到「日」粒度，不含小时分布——那会暴露作息，而且不是这个页面的用途。
export async function getStaticUsageHourly({ day }: AnyRecord = {}) {
  return { day, data: [] };
}

export async function getStaticUsageHeatmap({ weeks = 52, to, weekStartsOn = "sun", ...rest }: AnyRecord = {}) {
  const range = getHeatmapRangeLocal({
    weeks,
    now: to ? new Date(`${to}T00:00:00`) : new Date(),
    weekStartsOn,
  });
  const dailyRows = aggregateByDay(await loadDays(), normalizeFilter(rest)).filter((d) =>
    inRange(d.day, range.from, range.to),
  );
  const heatmap = buildActivityHeatmap({ dailyRows, weeks, to: range.to, weekStartsOn });
  return {
    ...heatmap,
    week_starts_on: weekStartsOn,
    active_days: dailyRows.filter((r) => r.billable_total_tokens > 0).length,
    streak_days: computeActiveStreakDays({ dailyRows, to: range.to }),
    total_cost_usd: dailyRows.reduce((s, r) => s + r.total_cost_usd, 0),
  };
}

export async function getStaticUsageModelBreakdown({ from, to, ...rest }: AnyRecord = {}) {
  const f = normalizeFilter(rest);
  const bySource = new Map<string, AnyRecord>();
  for (const d of await loadDays()) {
    if (!inRange(d.date, from, to)) continue;
    if (f.device && d.host !== f.device) continue;
    for (const r of d.rows) {
      if (!rowMatches(r, f)) continue;
      let src = bySource.get(r.source);
      if (!src) {
        src = { source: r.source, totals: emptyTotals(), models: new Map<string, AnyRecord>() };
        bySource.set(r.source, src);
      }
      addRow(src.totals, r);
      let m = src.models.get(r.model);
      if (!m) {
        m = { model: r.model, model_id: r.model, totals: emptyTotals() };
        src.models.set(r.model, m);
      }
      addRow(m.totals, r);
    }
  }
  const sources = [...bySource.values()].map((s) => ({
    source: s.source,
    totals: withCostString(s.totals),
    models: [...s.models.values()]
      .map((m) => ({ ...m, totals: withCostString(m.totals) }))
      .sort((a, b) => b.totals.total_tokens - a.totals.total_tokens),
  }));
  return {
    from,
    to,
    days: 0,
    sources,
    pricing: { model: "per-model", pricing_mode: "per_token_type", source: "contrail", effective_from: to || "" },
  };
}

/** 机器列表，用于按机器筛选。 */
export async function getStaticHosts(): Promise<string[]> {
  return fetchJson("hosts.json");
}
