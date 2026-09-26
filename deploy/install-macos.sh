#!/bin/bash
# 在 Mac 上安装每日发布任务（launchd）。重复运行是安全的：先卸载旧的再装。
set -euo pipefail
REPO="$(cd "$(dirname "$0")/.." && pwd)"
LABEL="com.functionhx.contrail"
DEST="$HOME/Library/LaunchAgents/$LABEL.plist"

mkdir -p "$HOME/.contrail" "$HOME/Library/LaunchAgents"
sed -e "s|__REPO__|$REPO|g" -e "s|__HOME__|$HOME|g" "$REPO/deploy/$LABEL.plist" > "$DEST"
launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
launchctl bootstrap "gui/$(id -u)" "$DEST"
echo "已安装：$DEST"
echo "每天本地 13:00 发布；日志：$HOME/.contrail/publish.log"
echo "立即跑一次：launchctl kickstart gui/$(id -u)/$LABEL"
