#!/usr/bin/env node
// Bumps the BomberMP game version across the monorepo.
//
//   node scripts/bump-version.mjs <major|minor|patch>
//   node scripts/bump-version.mjs <X.Y.Z>          # set explicitly
//
// Updates:
//   - root package.json
//   - apps/server, apps/client, packages/shared package.json
//   - packages/shared/src/version.ts (GAME_VERSION constant)

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');

const PACKAGE_JSONS = [
  'package.json',
  'apps/server/package.json',
  'apps/client/package.json',
  'packages/shared/package.json',
];

const VERSION_TS = 'packages/shared/src/version.ts';

function readJson(rel) {
  return JSON.parse(readFileSync(resolve(ROOT, rel), 'utf8'));
}

function writeJson(rel, obj) {
  writeFileSync(resolve(ROOT, rel), JSON.stringify(obj, null, 2) + '\n');
}

function parse(v) {
  const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(v).trim());
  if (!m) throw new Error(`Not a valid semver: ${v}`);
  return { major: +m[1], minor: +m[2], patch: +m[3] };
}

function fmt({ major, minor, patch }) {
  return `${major}.${minor}.${patch}`;
}

function bump(current, kind) {
  const v = parse(current);
  switch (kind) {
    case 'major': return fmt({ major: v.major + 1, minor: 0, patch: 0 });
    case 'minor': return fmt({ ...v, minor: v.minor + 1, patch: 0 });
    case 'patch': return fmt({ ...v, patch: v.patch + 1 });
    default: {
      // Treat as explicit version
      const explicit = parse(kind);
      return fmt(explicit);
    }
  }
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Usage: node scripts/bump-version.mjs <major|minor|patch|X.Y.Z>');
    process.exit(1);
  }

  const root = readJson('package.json');
  const current = root.version;
  const next = bump(current, arg);

  console.log(`Bumping version: ${current} → ${next}`);

  // Update all package.json files
  for (const rel of PACKAGE_JSONS) {
    const pkg = readJson(rel);
    pkg.version = next;
    writeJson(rel, pkg);
    console.log(`  updated ${rel}`);
  }

  // Update version.ts
  const versionTsPath = resolve(ROOT, VERSION_TS);
  const versionTs = readFileSync(versionTsPath, 'utf8');
  const updated = versionTs.replace(
    /export const GAME_VERSION = '[^']*';/,
    `export const GAME_VERSION = '${next}';`,
  );
  if (updated === versionTs) {
    console.error(`  WARNING: GAME_VERSION not found in ${VERSION_TS}`);
  } else {
    writeFileSync(versionTsPath, updated);
    console.log(`  updated ${VERSION_TS}`);
  }

  console.log(`\nDone. New version: ${next}`);
}

main();
