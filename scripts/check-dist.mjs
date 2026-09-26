#!/usr/bin/env node
// 构建产物的最后一道检查：页面不得向第三方发请求。
//
// 运行时由 CSP（connect-src 'self' 等）强制；这里确认 CSP 确实在产物里，
// 并且 HTML / CSS 没有直接引用任何外部资源（脚本、样式、字体、图片）。
// JS 里残留的 URL 字符串（React 报错文档链接、XML 命名空间）不会被请求，不检查。
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dashboard', 'dist');
const fail = (msg) => { console.error(`✗ ${msg}`); process.exitCode = 1; };

const html = readFileSync(join(dist, 'index.html'), 'utf8');
const csp = html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)"/)?.[1];
if (!csp) fail('index.html 缺少 Content-Security-Policy');
else {
  for (const d of ["default-src 'self'", "script-src 'self'", "connect-src 'self'"]) {
    if (!csp.includes(d)) fail(`CSP 缺少 ${d}`);
  }
}
for (const m of html.matchAll(/\b(?:src|href)\s*=\s*"(https?:)?\/\/[^"]*"/g)) fail(`index.html 引用了外部资源：${m[0]}`);

const walk = (dir) => readdirSync(dir, { withFileTypes: true })
  .flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
for (const f of walk(dist).filter((f) => f.endsWith('.css'))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/url\(\s*["']?(https?:)?\/\/[^)]*\)|@import\s+["']?(https?:)?\/\//g)) {
    fail(`${f} 引用了外部资源：${m[0]}`);
  }
}
if (!process.exitCode) console.log('✓ 产物只引用同源资源，CSP 已就位');
