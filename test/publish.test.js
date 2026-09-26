import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPayload, serialize, writeIfChanged, RETENTION_DAYS } from '../src/publish.js';
import { loadPrices } from '../src/pricing/cost.js';

const prices = loadPrices();
const NOW = new Date('2026-09-24T19:00:00Z'); // UTC+8 = 2026-09-25

const bucket = (over = {}) => ({
  source: 'claude-code',
  model: 'claude-opus-5',
  project: 'SECRET-PROJECT-NAME',
  hostname: 'test-host',
  bucketStart: '2026-09-24T12:00:00.000Z',
  inputTokens: 1_000_000,
  outputTokens: 0,
  cachedInputTokens: 0,
  reasoningOutputTokens: 0,
  cacheCreation5mTokens: 0,
  cacheCreation1hTokens: 0,
  totalTokens: 1_000_000,
  ...over,
});

test('输出里不含项目名（结构上就没有这个字段）', () => {
  const p = buildPayload([bucket()], prices, { host: 'h', now: NOW });
  const text = serialize(p);
  assert.ok(!text.includes('SECRET-PROJECT-NAME'), '项目名不得出现在输出里');
  assert.ok(!text.includes('project'), '连 project 这个键名都不该有');
  // 逐字段确认结构就是白名单。**这是一个正向白名单**：新增字段必须在这里显式加进来，
  // 否则测试会失败——这样"不小心把某个内部字段带出去"就不会静默发生。
  const TOKENS = ['cacheRead', 'cacheWrite', 'input', 'output', 'reasoning', 'tokens', 'tokensInclCache'];
  for (const d of p.days) {
    assert.deepEqual(Object.keys(d).sort(),
      [...TOKENS, 'conversations', 'cost', 'date', 'rows', 'turns'].sort());
    for (const r of d.rows) {
      assert.deepEqual(Object.keys(r).sort(), [...TOKENS, 'cost', 'model', 'source'].sort());
    }
  }
  assert.deepEqual(Object.keys(p.totals).sort(),
    [...TOKENS, 'conversations', 'cost', 'days', 'firstDate', 'lastDate', 'turns'].sort());
  assert.deepEqual(Object.keys(p).sort(),
    ['days', 'host', 'schemaVersion', 'timezone', 'totals', 'unpricedModels', 'updatedAt']);
});

test('会话只贡献两个计数，会话的项目名与 hash 不出现在输出里', () => {
  const sessions = [
    { source: 'codex', project: 'SECRET-PROJECT-NAME', sessionHash: 'deadbeefcafe0000',
      firstMessageAt: '2026-09-24T12:00:00.000Z', userMessageCount: 3 },
    { source: 'codex', project: 'x', sessionHash: 'x',
      firstMessageAt: '2026-09-24T13:00:00.000Z', userMessageCount: 2 },
  ];
  const p = buildPayload([bucket()], prices, { host: 'h', now: NOW, sessions });
  const text = serialize(p);
  assert.ok(!text.includes('SECRET-PROJECT-NAME'));
  assert.ok(!text.includes('deadbeefcafe'));
  assert.equal(p.days[0].conversations, 2);
  assert.equal(p.days[0].turns, 5);
  assert.equal(p.totals.conversations, 2);
});

test('同一天同模型、不同工具分成两行', () => {
  const p = buildPayload([bucket(), bucket({ source: 'codex' })], prices, { host: 'h', now: NOW });
  assert.deepEqual(p.days[0].rows.map((r) => r.source).sort(), ['claude-code', 'codex']);
});

test('五个 token 列之和（不含 cacheRead）等于 tokens，且与上游 totalTokens 一致', () => {
  const b = bucket({ inputTokens: 10, outputTokens: 20, reasoningOutputTokens: 30,
    cacheCreation5mTokens: 40, cacheCreation1hTokens: 50, cachedInputTokens: 60, totalTokens: 150 });
  const d = buildPayload([b], prices, { host: 'h', now: NOW }).days[0];
  assert.equal(d.cacheWrite, 90);
  assert.equal(d.tokens, 150);
  assert.equal(d.tokensInclCache, 210);
});

test('无价格的模型列进 unpricedModels', () => {
  const p = buildPayload([bucket({ model: 'no-such-model-xyz' })], prices, { host: 'h', now: NOW });
  assert.deepEqual(p.unpricedModels, ['no-such-model-xyz']);
});

test('不含绝对路径', () => {
  const p = buildPayload([bucket()], prices, { host: 'h', now: NOW });
  assert.ok(!/\/Users\/|\/home\/|[A-Z]:\\/.test(serialize(p)));
});

test('可复现：同样的输入产出同样的字节', () => {
  const bs = [bucket(), bucket({ bucketStart: '2026-09-23T12:00:00.000Z', model: 'gpt-5.5' })];
  const a = serialize(buildPayload(bs, prices, { host: 'h', now: NOW }));
  const b = serialize(buildPayload(bs, prices, { host: 'h', now: NOW }));
  assert.equal(a, b);
});

test('输入顺序不影响输出（内部排序稳定）', () => {
  const bs = [
    bucket({ bucketStart: '2026-09-24T12:00:00.000Z', model: 'gpt-5.5' }),
    bucket({ bucketStart: '2026-09-23T12:00:00.000Z', model: 'claude-opus-5' }),
  ];
  const forward = serialize(buildPayload(bs, prices, { host: 'h', now: NOW }));
  const reverse = serialize(buildPayload([...bs].reverse(), prices, { host: 'h', now: NOW }));
  assert.equal(forward, reverse, '打乱输入顺序不应改变输出');
});

test('日键按 UTC+8，日界在 UTC 16:00', () => {
  const before = bucket({ bucketStart: '2026-09-24T15:59:00.000Z' });
  const after = bucket({ bucketStart: '2026-09-24T16:00:00.000Z' });
  const p = buildPayload([before, after], prices, { host: 'h', now: NOW });
  const dates = p.days.map((d) => d.date);
  assert.deepEqual(dates, ['2026-09-24', '2026-09-25']);
});

test('超过保留期的日被裁掉', () => {
  const old = bucket({ bucketStart: '2020-01-01T12:00:00.000Z' });
  const p = buildPayload([old, bucket()], prices, { host: 'h', now: NOW });
  assert.equal(p.days.length, 1);
  assert.equal(p.days[0].date, '2026-09-24');
});

test('保留期边界：刚好在窗口内的最后一天会保留', () => {
  // UTC+8 今天 = 2026-09-25。保留 3 天 → 窗口 09-23..09-25
  const inWindow = bucket({ bucketStart: '2026-09-23T12:00:00.000Z' });
  const outWindow = bucket({ bucketStart: '2026-09-22T12:00:00.000Z' });
  const p = buildPayload([inWindow, outWindow], prices, { host: 'h', now: NOW, retentionDays: 3 });
  assert.deepEqual(p.days.map((d) => d.date), ['2026-09-23']);
});

test('rows 按成本降序，同成本按模型名升序', () => {
  const bs = [
    bucket({ model: 'bbb', inputTokens: 1_000_000 }),
    bucket({ model: 'aaa', inputTokens: 2_000_000 }),
    bucket({ model: 'ccc', inputTokens: 1_000_000 }),
  ];
  const p = buildPayload(bs, prices, { host: 'h', now: NOW });
  const models = p.days[0].rows.map((m) => m.model);
  // aaa 用 2M tokens，成本最高；bbb 与 ccc 同成本 → 按名字升序
  assert.deepEqual(models, ['aaa', 'bbb', 'ccc']);
});

test('token 总量与 cache read 分开统计', () => {
  const p = buildPayload([bucket({ cachedInputTokens: 9_000_000 })], prices, { host: 'h', now: NOW });
  assert.equal(p.days[0].tokens, 1_000_000);
  assert.equal(p.days[0].cacheRead, 9_000_000);
});

test('tokensInclCache 恒等于 tokens + cacheRead（页面和校验器都依赖这条）', () => {
  const bs = [
    bucket({ model: 'a', inputTokens: 1_000_000, cachedInputTokens: 9_000_000 }),
    bucket({ model: 'b', inputTokens: 500_000, cachedInputTokens: 0 }),
  ];
  const p = buildPayload(bs, prices, { host: 'h', now: NOW });
  for (const d of p.days) {
    assert.equal(d.tokensInclCache, d.tokens + d.cacheRead, `日 ${d.date}`);
    for (const m of d.rows) {
      assert.equal(m.tokensInclCache, m.tokens + m.cacheRead, `模型 ${m.model}`);
    }
  }
  const t = p.totals;
  assert.equal(t.tokensInclCache, t.tokens + t.cacheRead);
  assert.equal(t.tokens, p.days.reduce((a, d) => a + d.tokens, 0));
  assert.equal(t.cacheRead, p.days.reduce((a, d) => a + d.cacheRead, 0));
  assert.equal(t.days, p.days.length);
  assert.equal(t.firstDate, p.days[0].date);
  assert.equal(t.lastDate, p.days[p.days.length - 1].date);
});

test('没有数据时不写 null（校验器明确拒绝 null）', () => {
  const p = buildPayload([], prices, { host: 'h', now: NOW });
  assert.equal(p.days.length, 0);
  assert.equal(p.totals.days, 0);
  assert.ok(!('firstDate' in p.totals), 'firstDate 应省略而不是 null');
  assert.ok(!('lastDate' in p.totals), 'lastDate 应省略而不是 null');
  assert.ok(!serialize(p).includes('null'), '输出里不该出现 null');
});

test('序列化可复现 —— 这是「内容未变则跳过写盘」能成立的前提', () => {
  const a = serialize(buildPayload([bucket()], prices, { host: 'h', now: NOW }));
  const b = serialize(buildPayload([bucket()], prices, { host: 'h', now: NOW }));
  assert.equal(a, b);
});

test('writeIfChanged：内容相同则不写，mtime 不动', () => {
  const dir = mkdtempSync(join(tmpdir(), 'contrail-publish-'));
  try {
    const out = join(dir, 'nested', 'h.json'); // 顺便验证会自建父目录
    const text = serialize(buildPayload([bucket()], prices, { host: 'h', now: NOW }));

    assert.equal(writeIfChanged(out, text), true, '首次应写入');
    const mtime1 = statSync(out).mtimeMs;
    assert.equal(readFileSync(out, 'utf8'), text);

    assert.equal(writeIfChanged(out, text), false, '内容相同应跳过');
    assert.equal(statSync(out).mtimeMs, mtime1, 'mtime 不应变化 —— git 靠它判断有无改动');

    assert.equal(writeIfChanged(out, text + ' '), true, '内容变化应写入');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('保留期默认值是个有限天数', () => {
  assert.ok(Number.isFinite(RETENTION_DAYS) && RETENTION_DAYS > 0 && RETENTION_DAYS <= 3650);
});
