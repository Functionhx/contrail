#!/usr/bin/env node
// 把 data/<host>.json 复制到 dashboard/public/data/，并从目录推导 hosts.json。
//
// 清单在构建时生成、不进仓库：各机器只写自己的 data/<host>.json，没有共享文件，
// 也就没有写冲突，更不需要 CI 往仓库回推提交（那会带来自触发循环）。
//
// 只复制通过文件名规则的 <host>.json；schema 等其它文件不进站点。
import { copyFileSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'data');
const out = join(root, 'dashboard', 'public', 'data');

const hosts = readdirSync(src)
  .filter((f) => /^[A-Za-z0-9._-]+\.json$/.test(f) && f !== 'usage.schema.json')
  .map((f) => f.slice(0, -'.json'.length))
  .sort();

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const h of hosts) copyFileSync(join(src, `${h}.json`), join(out, `${h}.json`));
writeFileSync(join(out, 'hosts.json'), JSON.stringify(hosts) + '\n');
console.log(`site data: ${hosts.length} host(s) → ${out}`);
