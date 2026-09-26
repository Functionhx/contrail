#!/usr/bin/env python3
"""校验 data/*.json 是否符合 usage.schema.json，并做语义与隐私检查。

零依赖（只用标准库），这样在 CI、服务器、本地都能直接跑。

结构照搬 Functionhx/kaggle-agent 的 scripts/validate_dashboard.py，其中
`walk_public_values()` 那一段是最有价值的部分：它递归遍历**所有公开值**，
拒绝三类东西——null、敏感键名、以及字符串里出现的绝对路径。

为什么隐私检查要放在校验器里，而不是靠"写代码时小心"：
数据是自动发布的，没人会逐次人工审阅。把约束固化成断言，它才会在每次提交时
被执行；一旦哪天 contrail 的产出结构变了带出了路径，CI 会直接失败而不是静默公开。

这个脚本在两处执行：本机 `deploy/publish.sh` 推送**之前**（不过就不推），以及
CI 构建站点**之前**（不过就不发布）。两道都是硬闸门。

用法：
    python3 scripts/validate_usage.py [文件...]      # 缺省校验 data/ 下全部 .json
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections.abc import Mapping, Sequence
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = ROOT / "data"
SCHEMA_PATH = DATA_DIR / "usage.schema.json"

# schema 自身不是"某台机器的用量数据"，缺省校验时要跳过。
NON_DATA_FILES = {"usage.schema.json"}

# 这些键名一旦出现在公开数据里就是事故。用词根匹配，覆盖常见变体。
SENSITIVE_KEY_RE = re.compile(
    r"(project|path|dir|cwd|repo|repositor|file|prompt|message|content|token_count|"
    r"session|user|email|host_?key|secret|credential|api_?key)",
    re.IGNORECASE,
)

# 公开数据里不得出现本机绝对路径。
ABSOLUTE_PATH_RE = re.compile(r"(^|[\s\"'])(/Users/|/home/|/var/|/tmp/|[A-Za-z]:\\)")

# 模型名里允许出现的字符。挡住"某个模型名其实是条路径"这种情况。
MODEL_NAME_RE = re.compile(r"^[A-Za-z0-9._:/@+-]+$")

# 五个互不重叠的 token 列，以及由它们派生的两个汇总。
COLUMNS = ("input", "output", "reasoning", "cacheRead", "cacheWrite")
DERIVED = ("tokens", "tokensInclCache")

# 成本在发布端按 4 位小数舍入，逐行之和与当日值允许有舍入误差。
COST_TOLERANCE = 0.0001

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
HOST_RE = re.compile(r"^[A-Za-z0-9._-]+$")


class ValidationError(Exception):
    pass


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except OSError as error:
        raise ValidationError(f"{path}: 无法读取：{error}") from error
    except json.JSONDecodeError as error:
        raise ValidationError(f"{path}: JSON 解析失败：{error}") from error


# ── schema 校验（draft 2020-12 的最小子集）────────────────────────────────────

def is_type(value: Any, expected: str) -> bool:
    if expected == "object":
        return isinstance(value, Mapping)
    if expected == "array":
        return isinstance(value, list)
    if expected == "string":
        return isinstance(value, str)
    if expected == "integer":
        return isinstance(value, int) and not isinstance(value, bool)
    if expected == "number":
        return isinstance(value, (int, float)) and not isinstance(value, bool)
    if expected == "boolean":
        return isinstance(value, bool)
    if expected == "null":
        return value is None
    raise ValidationError(f"schema 里出现了不支持的 type: {expected}")


def check(value: Any, schema: Mapping[str, Any], path: str) -> None:
    """按 schema 递归校验。只实现本 schema 用到的关键字。"""
    if "const" in schema:
        if value != schema["const"]:
            raise ValidationError(f"{path}: 期望常量 {schema['const']!r}，得到 {value!r}")

    expected = schema.get("type")
    if expected and not is_type(value, expected):
        raise ValidationError(f"{path}: 期望 {expected}，得到 {type(value).__name__}")

    if isinstance(value, str):
        if "minLength" in schema and len(value) < schema["minLength"]:
            raise ValidationError(f"{path}: 长度小于 {schema['minLength']}")
        if "maxLength" in schema and len(value) > schema["maxLength"]:
            raise ValidationError(f"{path}: 长度超过 {schema['maxLength']}")
        if "pattern" in schema and not re.search(schema["pattern"], value):
            raise ValidationError(f"{path}: 不匹配 {schema['pattern']!r}：{value!r}")
        if "format" in schema and schema["format"] == "date-time":
            try:
                datetime.fromisoformat(value.replace("Z", "+00:00"))
            except ValueError as error:
                raise ValidationError(f"{path}: 不是合法的 date-time：{value!r}") from error

    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if "minimum" in schema and value < schema["minimum"]:
            raise ValidationError(f"{path}: 小于最小值 {schema['minimum']}")

    if isinstance(value, Sequence) and not isinstance(value, str):
        if "maxItems" in schema and len(value) > schema["maxItems"]:
            raise ValidationError(f"{path}: 元素超过 {schema['maxItems']} 个")
        item_schema = schema.get("items")
        if item_schema:
            for index, item in enumerate(value):
                check(item, item_schema, f"{path}[{index}]")

    if isinstance(value, Mapping):
        for name in schema.get("required", []):
            if name not in value:
                raise ValidationError(f"{path}: 缺少必需字段 {name!r}")
        properties = schema.get("properties", {})
        if schema.get("additionalProperties") is False:
            for name in value:
                if name not in properties:
                    raise ValidationError(f"{path}: 出现未定义的字段 {name!r}")
        for name, item in value.items():
            if name in properties:
                check(item, properties[name], f"{path}.{name}")


# ── 隐私守卫 ─────────────────────────────────────────────────────────────────

def walk_public_values(value: Any, path: str = "$") -> None:
    """拒绝 null、敏感键名、以及字符串里的绝对路径。

    这是整个脚本里最要紧的一段：它是**唯一**能保证"数据里没有不该有的东西"
    的机制。schema 只管形状，管不了"某个字符串字段里恰好塞了一条路径"。
    """
    if value is None:
        raise ValidationError(f"{path}: 不允许 null；未知值应当省略而不是写 null")

    if isinstance(value, Mapping):
        for key, item in value.items():
            if SENSITIVE_KEY_RE.search(str(key)):
                raise ValidationError(f"{path}.{key}: 禁止出现的字段名")
            walk_public_values(item, f"{path}.{key}")
        return

    if isinstance(value, list):
        for index, item in enumerate(value):
            walk_public_values(item, f"{path}[{index}]")
        return

    if isinstance(value, str) and ABSOLUTE_PATH_RE.search(value):
        raise ValidationError(f"{path}: 公开数据里不得出现绝对路径：{value!r}")


# ── 语义校验 ─────────────────────────────────────────────────────────────────

def check_derived(where: str, rec: Mapping[str, Any]) -> None:
    """tokens / tokensInclCache 必须由五列算出——页面直接读它们，算错会直接误导。"""
    tokens = rec["input"] + rec["output"] + rec["reasoning"] + rec["cacheWrite"]
    if rec["tokens"] != tokens:
        raise ValidationError(f"{where}: tokens ({rec['tokens']}) != input+output+reasoning+cacheWrite ({tokens})")
    if rec["tokensInclCache"] != tokens + rec["cacheRead"]:
        raise ValidationError(f"{where}: tokensInclCache ({rec['tokensInclCache']}) != tokens + cacheRead")


def validate_semantics(data: Mapping[str, Any], file_path: Path) -> None:
    walk_public_values(data)

    # host 必须与文件名一致 —— 否则两台机器的数据可能互相覆盖
    expected_host = file_path.stem
    if data["host"] != expected_host:
        raise ValidationError(
            f"{file_path.name}: host 字段为 {data['host']!r}，与文件名 {expected_host!r} 不一致"
        )
    if not HOST_RE.match(data["host"]):
        raise ValidationError(f"{file_path.name}: host 含非法字符")

    for name in data["unpricedModels"]:
        if not MODEL_NAME_RE.match(name):
            raise ValidationError(f"{file_path.name}: unpricedModels 含非法模型名：{name!r}")

    days = data["days"]
    previous = ""
    sums = dict.fromkeys(COLUMNS + DERIVED + ("conversations", "turns"), 0)
    cost_sum = 0.0
    for index, day in enumerate(days):
        where = f"{file_path.name}: days[{index}]"
        date = day["date"]
        if not DATE_RE.match(date):
            raise ValidationError(f"{where}: date 格式应为 YYYY-MM-DD，得到 {date!r}")
        # 严格升序同时排除了重复日期
        if previous and date <= previous:
            raise ValidationError(f"{where}: 日期必须严格升序（{previous} → {date}）")
        previous = date
        check_derived(where, day)

        seen_rows: set[tuple[str, str]] = set()
        row_sums = dict.fromkeys(COLUMNS, 0)
        row_cost = 0.0
        for r_index, row in enumerate(day["rows"]):
            rwhere = f"{where}.rows[{r_index}]"
            if not MODEL_NAME_RE.match(row["model"]):
                raise ValidationError(f"{rwhere}: 模型名含非法字符：{row['model']!r}")
            key = (row["source"], row["model"])
            if key in seen_rows:
                raise ValidationError(f"{rwhere}: (工具, 模型) {key} 重复")
            seen_rows.add(key)
            check_derived(rwhere, row)
            for c in COLUMNS:
                row_sums[c] += row[c]
            row_cost += row["cost"]

        # 逐行之和必须**精确**等于当日值：两者由同一批整数累加而来，任何偏差都
        # 说明发布端丢了行或重复计了行。
        for c in COLUMNS:
            if row_sums[c] != day[c]:
                raise ValidationError(f"{where}: rows 的 {c} 之和 ({row_sums[c]}) != 当日 {c} ({day[c]})")
        if abs(row_cost - day["cost"]) > COST_TOLERANCE * (len(day["rows"]) + 1):
            raise ValidationError(f"{where}: rows 的 cost 之和 ({row_cost:.4f}) 与当日 ({day['cost']}) 不符")

        for k in sums:
            sums[k] += day[k]
        cost_sum += day["cost"]

    # 顶层汇总必须与逐日之和一致 —— 它是页面的头部数字，错了一眼就会被看见
    totals = data["totals"]
    for k, v in sums.items():
        if totals[k] != v:
            raise ValidationError(f"{file_path.name}: totals.{k} ({totals[k]}) 与逐日之和 ({v}) 不符")
    if abs(totals["cost"] - cost_sum) > COST_TOLERANCE * (len(days) + 1):
        raise ValidationError(f"{file_path.name}: totals.cost ({totals['cost']}) 与逐日之和 ({cost_sum:.4f}) 不符")
    if totals["days"] != len(days):
        raise ValidationError(f"{file_path.name}: totals.days ({totals['days']}) != 实际天数 ({len(days)})")
    if days:
        if totals.get("firstDate") != days[0]["date"] or totals.get("lastDate") != days[-1]["date"]:
            raise ValidationError(f"{file_path.name}: totals 的 firstDate/lastDate 与 days 不符")
    elif "firstDate" in totals or "lastDate" in totals:
        raise ValidationError(f"{file_path.name}: 没有数据时不应有 firstDate/lastDate")


def validate_file(file_path: Path, schema: Mapping[str, Any]) -> None:
    data = load_json(file_path)
    check(data, schema, "$")
    validate_semantics(data, file_path)


def main(argv: Sequence[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("files", nargs="*", type=Path, help="要校验的文件（缺省为 data/ 下全部 .json）")
    args = parser.parse_args(argv)

    if not SCHEMA_PATH.is_file():
        print(f"错误：找不到 schema {SCHEMA_PATH}", file=sys.stderr)
        return 1
    schema = load_json(SCHEMA_PATH)

    targets = args.files or sorted(
        p for p in DATA_DIR.glob("*.json") if p.name not in NON_DATA_FILES
    )
    if not targets:
        print("没有找到要校验的数据文件。")
        return 0

    errors: list[str] = []
    for path in targets:
        try:
            validate_file(path, schema)
            shown = path.relative_to(ROOT) if path.is_absolute() and path.is_relative_to(ROOT) else path
            print(f"✓ {shown}")
        except ValidationError as error:
            errors.append(str(error))

    if errors:
        print("\n校验失败：", file=sys.stderr)
        for error in errors:
            print(f"  ✗ {error}", file=sys.stderr)
        return 1

    print(f"\n全部通过（{len(targets)} 个文件）。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
