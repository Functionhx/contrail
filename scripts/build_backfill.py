#!/usr/bin/env python3
"""生成 data/backfill.json：本地日志已经不在了的历史用量。

Claude Code 默认只保留 30 天会话记录（2026-09 才改为 3650 天），更早的用量在本地
日志里已经找不到。这里用三类来源把它们补回来，全部经 Claude Code 调用，所以
source 一律记为 claude-code：

1. DeepSeek：平台逐日账单（精确），扣掉本地日志已经记到的部分。
2. 智谱 GLM：6/14–6/26 用平台账单（精确）；3–8 月其余日子按套餐额度估算。
3. Claude：1–5 月按作者提供的总花费 $38,000 估算。

估算的每一条参数及其依据都写在下面。输入都在 backfill/inputs/，重复运行产出
同样的字节。

用法：python3 scripts/build_backfill.py
"""

from __future__ import annotations

import collections
import csv
import datetime as dt
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
INPUTS = ROOT / "backfill" / "inputs"
OUT = ROOT / "data" / "backfill.json"

# 人民币计价的项目（DeepSeek 实际扣费、部分 GLM 小模型目录价）按此折算为美元。
# 中国外汇交易中心 2026-09 上旬美元兑人民币中间价约 6.78。
CNY_PER_USD = 6.78

DAY = dt.timedelta(days=1)
D = dt.date.fromisoformat


def days(start: str, end: str):
    d = D(start)
    while d <= D(end):
        yield d
        d += DAY


def month_days(year: int, month: int):
    d = dt.date(year, month, 1)
    while d.month == month:
        yield d
        d += DAY


# ── 行的累加 ────────────────────────────────────────────────────────────────

COLUMNS = ("input", "output", "reasoning", "cacheRead", "cacheWrite")
rows: dict[tuple[str, str], dict] = {}  # (date, model) -> 行


def add(date: dt.date, model: str, cost_usd: float, **cols: float) -> None:
    key = (date.isoformat(), model)
    r = rows.setdefault(key, {"cost": 0.0, **{c: 0.0 for c in COLUMNS}})
    r["cost"] += cost_usd
    for c, v in cols.items():
        r[c] += v


def read_csv(name: str):
    with open(INPUTS / name, newline="") as f:
        yield from csv.DictReader(line for line in f if not line.startswith("#"))


# 本地日志已记到的用量（按日期 + 模型名），扣减用
measured = collections.defaultdict(lambda: [0, 0])  # (date, model) -> [tokens 不含 cache read, cacheRead]
for r in read_csv("measured-local.csv"):
    m = measured[(r["date"], r["model"].lower())]
    m[0] += int(r["tokens"])
    m[1] += int(r["cacheRead"])


# ── 1. DeepSeek：平台逐日账单，扣掉本地已记部分 ──────────────────────────────
#
# 按「日期 + 模型名」对应扣减，不能按天笼统扣：本地日志里的
# deepseek-v4.1-flash-expires-on-0910 在平台账单里完全没有出现（限时模型，
# 不计入该账号用量），按天扣会把它当成平台用量抵掉，少算真实用量。
#
# 花费：平台实际扣费（人民币）按扣减后留下的比例分摊。各列按 DeepSeek 官方价的
# 相对权重折算（未命中输入 1 : 缓存命中 0.02 : 输出 4），因为缓存命中 token 虽多
# 但几乎不花钱，按 token 数直接摊会严重高估。

DS_WEIGHT = {"miss": 1.0, "hit": 0.02, "output": 4.0}
DS_MODEL = {"deepseek-chat & deepseek-reasoner": "deepseek-chat"}  # 平台把两者合并计量；名字里的空格与 & 不能进公开数据

for r in read_csv("deepseek-platform-daily.csv"):
    miss, hit, out = int(r["miss"]), int(r["hit"]), int(r["output"])
    local_tokens, local_hit = measured.get((r["date"], r["model"].lower()), (0, 0))
    left_hit = max(0, hit - local_hit)
    # 本地的非 cache token 对应平台的「未命中输入 + 输出」，按平台的比例拆开扣
    non_cache = miss + out
    left_non_cache = max(0, non_cache - local_tokens)
    left_miss = round(miss * left_non_cache / non_cache) if non_cache else 0
    left_out = left_non_cache - left_miss
    if not (left_hit or left_miss or left_out):
        continue
    w_all = DS_WEIGHT["miss"] * miss + DS_WEIGHT["hit"] * hit + DS_WEIGHT["output"] * out
    w_left = DS_WEIGHT["miss"] * left_miss + DS_WEIGHT["hit"] * left_hit + DS_WEIGHT["output"] * left_out
    cost = float(r["cny"]) * (w_left / w_all if w_all else 0) / CNY_PER_USD
    add(D(r["date"]), DS_MODEL.get(r["model"], r["model"]), cost, input=left_miss, cacheRead=left_hit, output=left_out)


# ── 2. 智谱 GLM ─────────────────────────────────────────────────────────────
#
# 价格（美元 / 百万 token，输入 / 缓存命中 / 输出）：z.ai 官方价。
# z.ai 未列出的小模型用智谱开放平台账单里的目录价（人民币）折算。
GLM_PRICE = {
    "glm-5": (1.0, 0.2, 3.2),
    "glm-5.1": (1.4, 0.26, 4.4),
    "glm-5.2": (1.4, 0.26, 4.4),
    "glm-5.3": (1.4, 0.26, 4.4),
    "glm-4.7": (0.6, 0.11, 2.2),
    "glm-4.5-air": (0.2, 0.03, 1.1),
    "glm-4.6v": tuple(x / CNY_PER_USD for x in (1, 0.2, 3)),
    "glm-5v-turbo": tuple(x / CNY_PER_USD for x in (5, 1.2, 22)),
    "glm-4.6": tuple(x / CNY_PER_USD for x in (3, 3, 14)),
    "glm-5-turbo": tuple(x / CNY_PER_USD for x in (5, 5, 22)),
}


def glm_cost(model: str, inp: float, hit: float, out: float) -> float:
    pi, ph, po = GLM_PRICE[model]
    return (inp * pi + hit * ph + out * po) / 1e6


# 2a. 6/14–6/26 账单（精确）。同时从中取两样东西给估算用：各模型的 token 构成，
#     以及子代理/视觉模型相对主模型的用量比例。
bill = list(read_csv("zhipu-bill-2026-06-daily.csv"))
bill_mix = collections.defaultdict(lambda: [0, 0, 0])
for r in bill:
    inp, hit, out = int(r["input"]), int(r["hit"]), int(r["output"])
    add(D(r["date"]), r["model"], glm_cost(r["model"], inp, hit, out), input=inp, cacheRead=hit, output=out)
    m = bill_mix[r["model"]]
    m[0] += inp
    m[1] += hit
    m[2] += out
bill_total = {m: sum(v) for m, v in bill_mix.items()}
main_total = bill_total["glm-5.2"]

# 子代理与视觉模型：Claude Code 会把一部分工作交给较弱的模型；GLM 主模型没有视觉
# 能力，看图交给 GLM-4.6V。比例取自 6 月账单实测（相对全部 token）。
HELPERS = ("glm-4.7", "glm-4.6v", "glm-5v-turbo", "glm-4.5-air")
bill_all = sum(bill_total.values())
HELPER_SHARE = {m: bill_total[m] / bill_all for m in HELPERS}


def mix_of(model: str):
    inp, hit, out = bill_mix[model]
    t = inp + hit + out
    return inp / t, hit / t, out / t


MAIN_MIX = mix_of("glm-5.2")  # 主模型构成：缓存命中约 93%


def glm_main_model(d: dt.date) -> str:
    """按智谱官方发布时间切换主模型。"""
    if d < D("2026-03-27"):  # GLM-5（2026-02 发布）
        return "glm-5"
    if d < D("2026-06-13"):  # GLM-5.1：2026-03-27 向 Coding Plan 开放
        return "glm-5.1"
    if d < D("2026-08-14"):  # GLM-5.2：2026-06-13 向 Coding Plan 全量开放
        return "glm-5.2"
    return "glm-5.3"  # GLM-5.3：2026-08-14 发布


# 2b. 3–8 月按套餐额度估算：每月 8 亿 token，7、8 月较少。
GLM_MONTH_TOTAL = {3: 8e8, 4: 8e8, 5: 8e8, 6: 8e8, 7: 4e8, 8: 5e8}

# 已有精确数据的区间：区间内以实测为准（包括用量为 0 的日子——那是真实的 0），
# 估算只填区间外的日子，并从当月额度里扣掉区间内的实测量。
#   6/14–6/26：智谱账单覆盖
#   8/11 起：Linux 上的 Claude Code 会话记录从这天起完整保留（Mac 从 8/30 起）
GLM_COVERED = [(D("2026-06-14"), D("2026-06-26")), (D("2026-08-11"), D("2026-12-31"))]


def glm_covered(d: dt.date) -> bool:
    return any(a <= d <= b for a, b in GLM_COVERED)


glm_measured_by_month = collections.Counter()
for r in bill:
    glm_measured_by_month[D(r["date"]).month] += int(r["input"]) + int(r["hit"]) + int(r["output"])
for (date, model), (tokens, cache) in measured.items():
    if "glm" in model and glm_covered(D(date)):
        glm_measured_by_month[D(date).month] += tokens + cache

for month, total in GLM_MONTH_TOTAL.items():
    remaining = total - glm_measured_by_month[month]
    open_days = [d for d in month_days(2026, month) if not glm_covered(d)]
    if remaining <= 0 or not open_days:
        continue
    per_day = remaining / len(open_days)
    for d in open_days:
        parts = {m: per_day * s for m, s in HELPER_SHARE.items()}
        parts[glm_main_model(d)] = per_day - sum(parts.values())
        for model, t in parts.items():
            fi, fh, fo = MAIN_MIX if model.startswith("glm-5") and model not in HELPERS else mix_of(model)
            inp, hit, out = t * fi, t * fh, t * fo
            add(d, model, glm_cost(model, inp, hit, out), input=inp, cacheRead=hit, output=out)


# ── 3. Claude ───────────────────────────────────────────────────────────────
#
# 1–5 月：总花费 $38,000（作者提供）。2 月寒假最活跃，3 月初也活跃；1 月中旬起
# 放假；4、5 月回到学期中。
CLAUDE_TOTAL = 38_000
CLAUDE_MONTH_SHARE = {1: 0.16, 2: 0.27, 3: 0.23, 4: 0.18, 5: 0.16}


def claude_day_weight(d: dt.date) -> float:
    if d.month == 1:
        return 1.6 if d.day >= 15 else 0.6  # 1 月中旬起放寒假
    if d.month == 2:
        return 0.5 if D("2026-02-16") <= d <= D("2026-02-18") else 1.0  # 除夕至初二少用
    if d.month == 3:
        return 1.8 - 1.3 * (d.day - 1) / 30  # 3 月初最高，逐步回落
    return 1.0


def opus_model(d: dt.date) -> str:
    """按官方发布时间切换主模型（四代标准价相同：$5 / $25）。"""
    if d < D("2026-02-04"):
        return "claude-opus-4-5"
    if d < D("2026-04-16"):  # Opus 4.6：2026-02-04
        return "claude-opus-4-6"
    if d < D("2026-05-28"):  # Opus 4.7：2026-04-16
        return "claude-opus-4-7"
    return "claude-opus-4-8"  # Opus 4.8：2026-05-28


def fast_price_ratio(d: dt.date) -> float | None:
    """Fast 模式相对标准价的倍数；None 表示当时还没有 Fast。

    Opus 4.6 Fast 2026-02-07 上线，6 倍价，2/7–2/16 首发期五折（3 倍）；
    Opus 4.7 Fast 同为 6 倍；Opus 4.8 Fast 降为 2 倍。
    """
    if d < D("2026-02-07"):
        return None
    if d <= D("2026-02-16"):
        return 3.0
    if d < D("2026-05-28"):
        return 6.0
    return 2.0


# 花费拆分：
#   Fast：12%（作者当时会自己开 /fast）。
#   子代理：作者两台机器的 Claude Code 会话记录实测，子代理占花费 2.9%（Mac）与
#   1.9%（Linux），取 2.4%；其中约 95% 继承主 agent 的 Opus，约 5% 为 Sonnet，
#   会话记录里没有出现 Haiku。继承 Opus 的那部分与主 agent 同价同模型，并入 Opus 行。
FAST_SHARE = 0.12
SUBAGENT_SHARE = 0.024
SUBAGENT_SONNET = 0.05
SONNET_SHARE = SUBAGENT_SHARE * SUBAGENT_SONNET

# token 构成与每美元 token 数取自作者本地 Claude Code 实测的 Opus（同为 $5 / $25 价位）：
# 缓存读约 98.3%，每美元约 140.8 万 token。Sonnet 按官方价格比例（0.6 倍）换算。
OPUS_TOKENS_PER_USD = 1_407_593
OPUS_MIX = {"input": 0.00002, "output": 0.00320, "cacheRead": 0.98270, "cacheWrite": 0.01408}


def add_claude_day(d: dt.date, cost: float) -> None:
    ratio = fast_price_ratio(d)
    opus = opus_model(d)
    sonnet = "claude-sonnet-4-6" if d >= D("2026-02-17") else "claude-sonnet-4-5"  # Sonnet 4.6：2026-02-17
    fast = FAST_SHARE if ratio else 0.0
    parts = [(opus, 1 - fast - SONNET_SHARE, 1.0), (sonnet, SONNET_SHARE, 0.6)]
    if ratio:
        parts.append((f"{opus}-fast", fast, ratio))
    for model, share, price_ratio in parts:
        c = cost * share
        tokens = c * OPUS_TOKENS_PER_USD / price_ratio
        add(d, model, c, **{k: tokens * v for k, v in OPUS_MIX.items()})


for month, share in CLAUDE_MONTH_SHARE.items():
    ds = list(month_days(2026, month))
    weights = {d: claude_day_weight(d) for d in ds}
    total_w = sum(weights.values())
    for d, w in weights.items():
        add_claude_day(d, CLAUDE_TOTAL * share * w / total_w)


# ── 组装 v2 发布结构 ────────────────────────────────────────────────────────

def r4(x: float) -> float:
    return round(x + 0.0, 4)


def finalize_row(model: str, r: dict) -> dict:
    cols = {c: int(round(r[c])) for c in COLUMNS}
    tokens = cols["input"] + cols["output"] + cols["reasoning"] + cols["cacheWrite"]
    return {"source": "claude-code", "model": model, "cost": r4(r["cost"]), **cols,
            "tokens": tokens, "tokensInclCache": tokens + cols["cacheRead"]}


by_date = collections.defaultdict(list)
for (date, model), r in rows.items():
    row = finalize_row(model, r)
    if row["tokensInclCache"] > 0 or row["cost"] > 0:
        by_date[date].append(row)

out_days = []
for date in sorted(by_date):
    rs = sorted(by_date[date], key=lambda x: (-x["cost"], -x["tokensInclCache"], x["model"]))
    day = {"date": date, "cost": r4(sum(x["cost"] for x in rs))}
    for c in COLUMNS + ("tokens", "tokensInclCache"):
        day[c] = sum(x[c] for x in rs)
    day.update({"conversations": 0, "turns": 0, "rows": rs})
    out_days.append(day)

totals = {"cost": r4(sum(d["cost"] for d in out_days))}
for c in COLUMNS + ("tokens", "tokensInclCache"):
    totals[c] = sum(d[c] for d in out_days)
totals.update({"conversations": 0, "turns": 0, "days": len(out_days),
               "firstDate": out_days[0]["date"], "lastDate": out_days[-1]["date"]})

payload = {
    "host": "backfill",
    "schemaVersion": 2,
    # 固定时刻：输入不变则产出字节不变
    "updatedAt": "2026-09-26T00:00:00Z",
    "timezone": "UTC+8",
    "totals": totals,
    "unpricedModels": [],
    "days": out_days,
}
OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

by_model = collections.Counter()
by_model_cost = collections.Counter()
for d in out_days:
    for r in d["rows"]:
        by_model[r["model"]] += r["tokensInclCache"]
        by_model_cost[r["model"]] += r["cost"]
print(f"写入 {OUT.relative_to(ROOT)}：{len(out_days)} 天，{totals['tokensInclCache']:,} tokens，${totals['cost']:,.2f}（≈ ¥{totals['cost'] * CNY_PER_USD:,.0f}）")
for m, t in by_model.most_common():
    print(f"  {m:<32}{t:>18,}  ${by_model_cost[m]:>11,.2f}")
