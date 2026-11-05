// Manual refresh of the raw SRD subset. Never run by build, CI or tests.
// Usage: pnpm --filter @iron-scribe/system-dnd5e-2024 srd:import
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SHA = 'a6212beb4b278917c2cff41c2b04c4ef4f3e0d6f';
const BASE = `https://raw.githubusercontent.com/5e-bits/5e-database/${SHA}/src/2024/en`;
const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'srd-5.2.1');

const FILES = [
  {
    upstream: '5e-SRD-Monsters.json',
    out: 'monsters.json',
    keep: [
      'goblin-warrior',
      'goblin-minion',
      'skeleton',
      'zombie',
      'wolf',
      'giant-rat',
      'bandit',
      'guard',
      'kobold-warrior',
      'cultist',
      'ogre',
    ],
  },
  {
    upstream: '5e-SRD-Equipment.json',
    out: 'equipment.json',
    keep: [
      'dagger',
      'shortsword',
      'scimitar',
      'rapier',
      'longsword',
      'greatsword',
      'mace',
      'quarterstaff',
      'handaxe',
      'spear',
      'javelin',
      'greatclub',
      'shortbow',
      'light-crossbow',
      'leather-armor',
      'chain-shirt',
      'chain-mail',
      'shield',
    ],
  },
  {
    upstream: '5e-SRD-Spells.json',
    out: 'spells.json',
    keep: ['fire-bolt', 'sacred-flame', 'magic-missile', 'cure-wounds', 'burning-hands'],
  },
  { upstream: '5e-SRD-Weapon-Properties.json', out: 'weapon-properties.json', keep: null },
  {
    upstream: '5e-SRD-Weapon-Mastery-Properties.json',
    out: 'weapon-mastery-properties.json',
    keep: null,
  },
];

await mkdir(join(OUT, 'raw'), { recursive: true });
for (const f of FILES) {
  const res = await fetch(`${BASE}/${f.upstream}`);
  if (!res.ok) throw new Error(`${f.upstream}: HTTP ${res.status}`);
  const all = await res.json();
  const rows = f.keep ? all.filter((e) => f.keep.includes(e.index)) : all;
  if (f.keep && rows.length !== f.keep.length) {
    const have = new Set(rows.map((e) => e.index));
    throw new Error(`${f.upstream}: missing ${f.keep.filter((k) => !have.has(k)).join(', ')}`);
  }
  rows.sort((a, b) => a.index.localeCompare(b.index));
  await writeFile(join(OUT, 'raw', f.out), `${JSON.stringify(rows, null, 2)}\n`);
  console.log(`${f.out}: ${rows.length} entries`);
}

const source = {
  upstream: 'https://github.com/5e-bits/5e-database',
  path: 'src/2024/en',
  commit: SHA,
  license: 'MIT (data repo); content is SRD 5.2.1, CC-BY-4.0',
  fetched: new Date().toISOString().slice(0, 10),
  files: FILES.map((f) => ({ upstream: f.upstream, raw: f.out, entries: f.keep?.length ?? 'all' })),
};
await writeFile(join(OUT, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`);
