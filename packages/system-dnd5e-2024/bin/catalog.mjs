#!/usr/bin/env node
/**
 * Smoke check for the full SRD catalog. Build first:
 *
 *   pnpm --filter @iron-scribe/system-dnd5e-2024 build
 *   pnpm --filter @iron-scribe/system-dnd5e-2024 catalog
 */
import { loadCatalog, monsterToEntity, readMonsterSnapshot } from '../dist/index.js';

const checks = [];
const check = (name, ok, detail) => checks.push({ name, ok, detail });
const ids = (rows) => rows.map((r) => r.id);

const catalog = loadCatalog();
const get = (section, id) => {
  const entry = section.get(id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
};

const sizes = {
  monsters: 341,
  weapons: 38,
  armor: 13,
  gear: 131,
  magicItems: 262,
  spells: 339,
  conditions: 15,
  skills: 18,
};
for (const [section, expected] of Object.entries(sizes)) {
  const got = catalog[section].list().length;
  check(`${section} count`, got === expected, `${got} (expected ${expected})`);
}

const goblins = ids(catalog.monsters.find('goblin'));
check(
  'find("goblin") is the three goblins, not the hobgoblins',
  goblins.join(',') === 'goblin-boss,goblin-minion,goblin-warrior',
  goblins.join(', '),
);
check(
  'find("Goblin Warrior") is exact',
  ids(catalog.monsters.find('Goblin Warrior')).join(',') === 'goblin-warrior',
  '',
);

const ghost = get(catalog.monsters, 'ghost');
check('ghost hovers', ghost.speed.hover === true && ghost.speed.fly === 40, '');

const aboleth = get(catalog.monsters, 'aboleth').actions.find((a) => a.name === 'Multiattack');
check(
  'aboleth Multiattack is data',
  aboleth?.multiattack?.steps[0]?.count === 2 && aboleth.multiattack.options?.choose === 1,
  '',
);
const tentacle = get(catalog.monsters, 'aboleth').actions.find((a) => a.name === 'Tentacle');
check(
  'aboleth Tentacle keeps its save',
  tentacle?.attackBonus === 9 && tentacle.save?.dc === 14,
  '',
);

const dragon = get(catalog.monsters, 'adult-red-dragon');
const casting = dragon.actions.find((a) => a.name === 'Spellcasting');
check(
  'adult red dragon spellcasting and lair XP',
  casting?.spellcasting?.dc === 20 &&
    dragon.xpInLair === 20000 &&
    dragon.legendaryActions.length === 3,
  '',
);
check(
  'vampire mist has no actions',
  get(catalog.monsters, 'vampire-mist').actions.length === 0,
  '',
);
check(
  'rakshasa vulnerability stays qualified',
  get(catalog.monsters, 'rakshasa').vulnerabilities.length === 0 &&
    get(catalog.monsters, 'rakshasa').conditionalDefenses[0]?.type === 'piercing',
  '',
);

const byMechanics = { override: 0, parsed: 0, 'text-only': 0 };
for (const spell of catalog.spells.list()) byMechanics[spell.mechanics] += 1;
check(
  'spell mechanics split',
  byMechanics.override === 5 && byMechanics.parsed === 132 && byMechanics['text-only'] === 202,
  JSON.stringify(byMechanics),
);
check(
  'fireball is parsed, fire bolt is an override',
  get(catalog.spells, 'fireball').mechanics === 'parsed' &&
    get(catalog.spells, 'fire-bolt').mechanics === 'override',
  '',
);

check('arrows are ammunition', get(catalog.gear, 'arrows').kind === 'ammunition', '');
check(
  'magic ammunition links its variants',
  get(catalog.magicItems, 'ammunition').variants.join(',') ===
    'ammunition-1,ammunition-2,ammunition-3' &&
    get(catalog.magicItems, 'ammunition-2').variantOf === 'ammunition',
  '',
);

const roundTrip = JSON.parse(JSON.stringify(monsterToEntity(dragon, 'dragon_1')));
check(
  'dragon snapshot survives JSON',
  readMonsterSnapshot(roundTrip).id === 'adult-red-dragon' &&
    readMonsterSnapshot(roundTrip).hp === dragon.hp,
  '',
);

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? 'ok  ' : 'FAIL'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
  if (!c.ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
