#!/usr/bin/env node
// Copies `common/src` into this tree's `src/__shared__`, which is generated and
// gitignored: never edit those files, edit `common/src` and run this again.
//
// Why a copy and not an import: each of the three builds has its own root (a compose
// context each), and two of them cannot reach outside it. `frontend/tsconfig.app.json`
// includes `src`, the engine states `rootDir: ./src`, and the backend has no `rootDir`
// at all, so a `../common/src` import would move `dist/main.js` for the backend and fail
// the engine's rootDir outright. A copy keeps every path and every start script byte for
// byte as it was. The same body is dropped in all three trees because each one builds on
// its own; it finds the source by walking up from its own location.
//
// Sources are tried in order, first hit wins:
//   LUDO_COMMON_SRC          an explicit override
//   ../common/src            backend/, frontend/
//   ../../../common/src      backend/app/ludo-engine/
//   /common/src              the compose mount into the frontend containers
//
// Modes:
//   node scripts/sync-shared.mjs           copy (what `prebuild`/`predev` run)
//   node scripts/sync-shared.mjs --check   compare only, exit 1 on drift (harnesses)
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const treeRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(treeRoot, 'src', '__shared__');
const checkOnly = process.argv.includes('--check');

const candidates = [
  process.env.LUDO_COMMON_SRC,
  path.resolve(treeRoot, '../common/src'),
  path.resolve(treeRoot, '../../../common/src'),
  '/common/src',
].filter(Boolean);

// `timing.constants.ts` is the marker: a folder that has it is the shared source, not some other
// `common` on the way up.
const source = candidates.find((dir) => existsSync(path.join(dir, 'timing.constants.ts')));

if (!source) {
  // An image that copied the files from the shared build context, or a container whose
  // tree already carries a host-synced copy: nothing to do, and nothing to warn about.
  if (existsSync(target)) {
    console.log('sync-shared: no common/src beside this tree, using the copy already there');
    process.exit(0);
  }
  console.error(
    'sync-shared: common/src not found and src/__shared__ is missing. Looked in:\n  ' +
      candidates.join('\n  '),
  );
  process.exit(1);
}

const files = readdirSync(source)
  .filter((name) => name.endsWith('.ts'))
  .sort();

if (checkOnly) {
  const drift = files.filter((name) => {
    const copy = path.join(target, name);
    return !existsSync(copy) || !readFileSync(copy).equals(readFileSync(path.join(source, name)));
  });
  const stale = existsSync(target)
    ? readdirSync(target).filter((name) => name.endsWith('.ts') && !files.includes(name))
    : [];
  if (drift.length > 0 || stale.length > 0) {
    console.error(
      `sync-shared: ${path.relative(treeRoot, target)} is out of date` +
        (drift.length > 0 ? `\n  changed or missing: ${drift.join(', ')}` : '') +
        (stale.length > 0 ? `\n  not in common/src: ${stale.join(', ')}` : ''),
    );
    process.exit(1);
  }
  console.log(`sync-shared: ${files.length} files match common/src`);
  process.exit(0);
}

rmSync(target, { recursive: true, force: true });
mkdirSync(target, { recursive: true });
for (const name of files) cpSync(path.join(source, name), path.join(target, name));
console.log(
  `sync-shared: ${files.length} files from ${source} -> ${path.relative(treeRoot, target)}`,
);
