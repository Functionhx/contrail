#!/bin/bash
# 定时发布：解析本机日志 → 产出 data/<host>.json → 校验 → 提交推送。
#
# 由 launchd（Mac）或 systemd timer（Linux）调用，也可以手动跑。
# 每台机器只写自己那一个 data/<host>.json，所以多台机器同时推送也不会冲突；
# 汇总发生在网页里（浏览器读取全部机器的文件后合并）。
#
# 设计要点（沿用 vibe-local 踩过的坑）：
#
#  1. **校验不通过就绝不推送**。scripts/validate_usage.py 里有隐私守卫
#     （拒绝 null、敏感键名、绝对路径），它是「公开数据里没有不该有的东西」
#     这条保证的执行点。
#  2. **有变化才提交**。先 git add 再查暂存区——git diff 看不见新建文件。
#  3. **先 pull --rebase**。另一台机器可能刚推过；各写各的文件，rebase 不会冲突。
#  4. **只提交自己的文件**。git add 只加 data/<host>.json，不会顺手带上别的改动。
#
# 路径不写死：脚本所在仓库就是工作目录，两台机器共用同一份脚本。

set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
HOST="${CONTRAIL_HOST:-$(hostname -s)}"
OUT="data/${HOST}.json"

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }

log "开始：host=$HOST repo=$REPO"
cd "$REPO"

if ! git pull --rebase --quiet; then
  log "错误：git pull --rebase 失败。检查网络，或仓库里是否有未提交的改动。"
  exit 1
fi

if ! node bin/contrail.js publish --repo "$REPO" --host "$HOST"; then
  log "错误：publish 失败。"
  exit 1
fi

if ! python3 scripts/validate_usage.py "$OUT" >/dev/null; then
  log "错误：数据校验未通过，拒绝推送。详情："
  python3 scripts/validate_usage.py "$OUT" || true
  exit 1
fi
log "校验通过。"

git add -- "$OUT"
if git diff --cached --quiet; then
  log "数据无变化，跳过提交。"
  exit 0
fi

git commit --quiet -m "data: $HOST $(date -u +%Y-%m-%dT%H:%MZ)" -- "$OUT"
if ! git push --quiet; then
  log "错误：git push 失败。数据已提交到本地，下次运行会一并推送。"
  exit 1
fi
log "已推送。"
