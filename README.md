# Contrail · 航迹云

Claude Code、Codex、OpenCode 的每日 token 用量与估算花费，定时发布到个人网站。

**站点**：https://functionhx.github.io/contrail/

> 航迹云：看得见飞机划过的轨迹，看不见机舱里坐着谁。
> 这里只公开聚合数字——没有项目名、文件路径、会话 id 或任何对话内容。

## 它怎么工作

```
Mac  ── contrail publish ──▶ data/machen-3.json ─┐
Linux ─ contrail publish ──▶ data/chen.json ─────┼─▶ GitHub Actions ─▶ GitHub Pages
                                                  │   校验 → 构建页面      （浏览器里汇总
（每台机器定时解析本机日志，只写自己那一个文件） ─┘                        全部机器）
```

- **采集**（`bin/`、`src/`）：纯本地、零依赖。只读 Claude Code / Codex / OpenCode 的本地日志，不联网、不读任何凭证、不装常驻服务。parser 层提取自 [`@vibe-cafe/vibe-usage`](https://github.com/vibe-cafe/vibe-usage)，来源与每一处改动见 [`src/upstream/UPSTREAM.md`](src/upstream/UPSTREAM.md)。
- **发布**（`deploy/`）：每台机器每天一次，产出 `data/<机器名>.json` → 校验 → 推送。各写各的文件，多台机器同时推送也不冲突。
- **页面**（`dashboard/`）：[TokenTracker](https://github.com/xiufengsun/TokenTracker) 的 dashboard，裁剪到只剩用量视图，数据层换成读同源的静态 JSON。

## 隐私：三道闸门

数据是自动发布的，没人会逐次人工审阅，所以约束都做成了会失败的检查：

1. **结构上就没有**：发布端（`src/publish.js`）只产出数字、工具名、模型名。schema（`data/usage.schema.json`）用 `additionalProperties: false` 固化，多一个字段就校验失败。
2. **隐私守卫**：`scripts/validate_usage.py` 递归检查全部公开值，拒绝 `null`、敏感键名（project / path / session / prompt …）与字符串里的绝对路径。本机推送前、CI 发布前各跑一次，不过就不推、不发。
3. **页面不向第三方发请求**：构建产物带 CSP（`connect-src 'self'` 等），CI 里 `scripts/check-dist.mjs` 确认 CSP 在位、HTML/CSS 没有外部资源。上游 dashboard 的埋点（PostHog、Vercel）、云端登录、汇率 API、GitHub star 计数等已全部移除。

## 本地使用

需要 Node ≥ 22.5（用到内置 `node:sqlite`）与 Python 3。采集层零依赖。

```bash
node bin/contrail.js --days 7        # 终端里看最近 7 天
node bin/contrail.js publish --repo . --host <机器名>   # 产出 data/<机器名>.json
python3 scripts/validate_usage.py    # 校验
npm test                             # 采集层测试
```

预览页面：

```bash
node scripts/prepare-site-data.mjs
cd dashboard && npm ci --ignore-scripts && npm run dev
```

## 部署定时发布

**Mac**（launchd，每天本地 13:00；睡眠错过会在唤醒后补跑）：

```bash
deploy/install-macos.sh
```

**Linux**（systemd user timer）：

```bash
git clone https://github.com/Functionhx/contrail.git ~/contrail
mkdir -p ~/.config/systemd/user
sed "s/YOURUSER/$USER/g" ~/contrail/deploy/contrail-publish.service > ~/.config/systemd/user/contrail-publish.service
cp ~/contrail/deploy/contrail-publish.timer ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now contrail-publish.timer
sudo loginctl enable-linger "$USER"   # 不登录时定时器也照常运行
```

机器名默认取 `hostname -s`，可用 `CONTRAIL_HOST` 覆盖。

## 历史补录

Claude Code 默认只保留 30 天会话记录，更早的用量在本地日志里已经找不到。`data/backfill.json`
由 `scripts/build_backfill.py` 生成，输入在 `backfill/inputs/`：

- **DeepSeek**：平台逐日账单（精确），按「日期 + 模型名」扣掉本地日志已记到的部分。
- **智谱 GLM**：6/14–6/26 用平台账单（精确）；3–8 月其余日子按 Coding 套餐额度估算，主模型按官方发布时间切换，子代理与视觉模型（GLM-4.6V）按账单实测比例。
- **Claude**：2026 年 1–4 月按总花费估算，按月与按模型的分配方式及依据见脚本注释。

两台机器今后的用量由日志直接统计（保留期已改为 3650 天），发布时与上次合并，不会因日志清理而丢失。

## 口径

- 日期是 **UTC+8** 日历日，页面也固定按 UTC+8 计算周期。
- 页面上的 token 总量**含 cache read**（实际处理量）；每日明细里分列 input / output / cached / reasoning。
- 花费按 `src/pricing/prices.json`（手工策展、每条带官方来源）估算；查不到价格的模型按 $0 计并列在数据的 `unpricedModels` 里，所以花费是下界。

## License

MIT，见 [LICENSE](LICENSE)。parser 层来自 vibe-usage（MIT），页面来自 TokenTracker（MIT，原文见 `dashboard/LICENSE.tokentracker`）。
