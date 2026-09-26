import fs from "node:fs";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { copyRegistryPlugin } from "./scripts/copy-registry-plugin.mjs";

// Contrail 的构建配置刻意极简：React、文案表、CSP 三个插件。
//
// 上游的 vite.config.js 在 dev 服务器里会 `npx tokentracker-cli sync`（从 npm
// 现拉最新版执行）、require 仓库根的本地 API 去读本机日志、并把 /proxy/ipcheck
// 代理到第三方。这些在一个只读静态 JSON 的公开页面里都不需要，全部不要。

// 页面只允许访问同源资源。这是「不向任何第三方发请求」的**强制**保证：即使
// 哪天某个依赖偷偷加了 fetch / 外链字体 / 统计脚本，浏览器也会直接拦下。
// style-src 需要 'unsafe-inline'：Tailwind 之外，motion 动画用内联 style 属性。
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join("; ");

// 只在构建产物里注入：dev 服务器的热更新依赖内联脚本，开着 CSP 会跑不起来。
function cspPlugin() {
  return {
    name: "contrail-csp",
    apply: "build",
    transformIndexHtml(html) {
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`,
      );
    },
  };
}

// 维护用：CONTRAIL_LIST_MODULES=<文件> 时把打进产物的源文件清单写出来，用来
// 找出不再被引用的上游文件。
function listModulesPlugin() {
  const out = process.env.CONTRAIL_LIST_MODULES;
  return {
    name: "contrail-list-modules",
    apply: "build",
    generateBundle(_options, bundle) {
      if (!out) return;
      const ids = [...this.getModuleIds()].filter((id) => !id.startsWith("\0")).sort();
      fs.writeFileSync(out, ids.join("\n") + "\n");
      // 附带每个模块在产物里的实际字节数，用来找体积大头
      const sizes = [];
      for (const chunk of Object.values(bundle)) {
        if (chunk.type !== "chunk") continue;
        for (const [id, info] of Object.entries(chunk.modules)) sizes.push(`${info.renderedLength}\t${id}`);
      }
      fs.writeFileSync(`${out}.sizes`, sizes.join("\n") + "\n");
    },
  };
}

export default defineConfig({
  base: "./",
  plugins: [copyRegistryPlugin(), react(), cspPlugin(), listModulesPlugin()],
  build: { outDir: "dist", emptyOutDir: true },
  server: { port: 5173, strictPort: false },
});
