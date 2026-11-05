// Manual refresh of the SRD data and the copied upstream schemas.
// Never run by build, CI or tests.
// Usage: pnpm --filter @iron-scribe/system-dnd5e-2024 srd:import
//
// Flow: download -> staging dir + src/catalog/upstream -> strict validation of
// staging (vitest) -> swap staging into raw/ and write SOURCE.json.
import { spawnSync } from 'node:child_process';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = '6dfaa6e2f1aefc466fb45b9a64e4dd11a537ca53';
const REPO = 'https://github.com/5e-bits/5e-srd-api';
const UPSTREAM_PATH = 'packages/5e-database';
const RAW_BASE = `https://raw.githubusercontent.com/5e-bits/5e-srd-api/${SHA}/${UPSTREAM_PATH}`;

const PKG = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATA = join(PKG, 'data', 'srd-5.2.1');
const STAGING = join(DATA, '.staging');
const UPSTREAM_DIR = join(PKG, 'src', 'catalog', 'upstream');

const NAMES = [
  'Ability-Scores',
  'Alignments',
  'Backgrounds',
  'Classes',
  'Conditions',
  'Damage-Types',
  'Equipment-Categories',
  'Equipment',
  'Feats',
  'Features',
  'Languages',
  'Levels',
  'Magic-Items',
  'Magic-Schools',
  'Monsters',
  'Poisons',
  'Proficiencies',
  'Skills',
  'Species',
  'Spells',
  'Subclasses',
  'Subspecies',
  'Traits',
  'Weapon-Mastery-Properties',
  'Weapon-Properties',
];

const FILES = NAMES.map((n) => ({
  upstream: `5e-SRD-${n}.json`,
  schemaFile: `5e-SRD-${n}.ts`,
  out: `${n.toLowerCase()}.json`,
}));

const get = async (path) => {
  const res = await fetch(`${RAW_BASE}/${path}`);
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res.text();
};

const header = (path) =>
  `// COPIED FROM UPSTREAM - DO NOT EDIT. Written only by \`pnpm srd:import\`.\n` +
  `// Source: ${REPO}/blob/${SHA}/${UPSTREAM_PATH}/${path} (MIT, see LICENSE.md)\n`;

await rm(STAGING, { recursive: true, force: true });
await mkdir(STAGING, { recursive: true });
await rm(UPSTREAM_DIR, { recursive: true, force: true });
await mkdir(join(UPSTREAM_DIR, 'schemas'), { recursive: true });

// Data
const counts = {};
for (const f of FILES) {
  const all = JSON.parse(await get(`src/2024/en/${f.upstream}`));
  all.sort((a, b) => a.index.localeCompare(b.index));
  counts[f.out] = all.length;
  await writeFile(join(STAGING, f.out), `${JSON.stringify(all, null, 2)}\n`);
  console.log(`${f.out}: ${all.length} entries`);
}

// Copied schemas
await writeFile(join(UPSTREAM_DIR, 'LICENSE.md'), await get('LICENSE.md'));
await writeFile(
  join(UPSTREAM_DIR, 'common.ts'),
  header('src/schemas/common.ts') + (await get('src/schemas/common.ts')),
);
const entries = [];
for (const f of FILES) {
  const src = await get(`src/2024/schemas/${f.schemaFile}`);
  const body = src.replaceAll("'../../schemas/common'", "'../common.js'");
  if (/from '\.\.\/\.\.\//.test(body)) throw new Error(`${f.schemaFile}: unexpected import`);
  const exported = [...body.matchAll(/export const (\w+Schema)\b/g)].map((m) => m[1]);
  if (exported.length !== 1) {
    throw new Error(`${f.schemaFile}: expected one exported schema, got ${exported.join(', ')}`);
  }
  await writeFile(
    join(UPSTREAM_DIR, 'schemas', f.schemaFile),
    header(`src/2024/schemas/${f.schemaFile}`) + body,
  );
  entries.push({ ...f, schema: exported[0] });
}
const imports = entries
  .map((e) => `import { ${e.schema} } from './schemas/${e.schemaFile.replace('.ts', '.js')}';`)
  .join('\n');
const list = entries
  .map((e) => `  { upstream: '${e.upstream}', raw: '${e.out}', schema: ${e.schema} },`)
  .join('\n');
await writeFile(
  join(UPSTREAM_DIR, 'index.ts'),
  `${header('(generated)')}${imports}\n\nexport const UPSTREAM_FILES = [\n${list}\n] as const;\n`,
);

// Strict validation of staging
const test = spawnSync('pnpm', ['exec', 'vitest', 'run', 'src/catalog/raw-validation.test.ts'], {
  cwd: PKG,
  stdio: 'inherit',
  env: { ...process.env, SRD_RAW_DIR: STAGING },
});
if (test.status !== 0) {
  await rm(STAGING, { recursive: true, force: true });
  throw new Error('Validation failed: raw/ and SOURCE.json left untouched.');
}

// Swap
await rm(join(DATA, 'raw'), { recursive: true, force: true });
await rename(STAGING, join(DATA, 'raw'));
const source = {
  upstream: REPO,
  path: `${UPSTREAM_PATH}/src/2024/en`,
  commit: SHA,
  license: 'MIT (data repo); content is SRD 5.2.1, CC-BY-4.0',
  fetched: new Date().toISOString().slice(0, 10),
  files: FILES.map((f) => ({ upstream: f.upstream, raw: f.out, entries: counts[f.out] })),
};
await writeFile(join(DATA, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
console.log('Import complete.');
