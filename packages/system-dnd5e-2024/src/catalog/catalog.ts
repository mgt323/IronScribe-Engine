import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { z } from 'zod';

import { isWeapon, normalizeArmor, normalizeWeapon } from './normalize-equipment.js';
import { normalizeMonster } from './normalize-monster.js';
import { normalizeSpell } from './normalize-spell.js';
import { EXTRA_MONSTER_DAMAGE } from './overrides.js';
import { RAW_DIR } from './paths.js';
import { RawEquipment, RawMonster, RawSpell } from './raw-schema.js';
import { createSection, type CatalogSection } from './section.js';
import type { Armor, Monster, Weapon } from './schema.js';
import type { Spell } from './schema-spell.js';

export interface Catalog {
  readonly monsters: CatalogSection<Monster>;
  readonly weapons: CatalogSection<Weapon>;
  readonly armor: CatalogSection<Armor>;
  readonly spells: CatalogSection<Spell>;
}

const read = <T extends z.ZodType>(file: string, schema: T): z.infer<T>[] =>
  z.array(schema).parse(JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')));

function withExtraDamage(m: Monster): Monster {
  const extra = EXTRA_MONSTER_DAMAGE[m.id];
  if (!extra) return m;
  return {
    ...m,
    actions: m.actions.map((a) =>
      a.id === extra.action
        ? { ...a, damage: [...a.damage, { dice: extra.dice, type: extra.type, condition: null }] }
        : a,
    ),
  };
}

let cached: Catalog | undefined;

export function loadCatalog(): Catalog {
  if (cached) return cached;
  const equipment = read('equipment.json', RawEquipment);
  cached = {
    monsters: createSection(
      read('monsters.json', RawMonster).map((r) => withExtraDamage(normalizeMonster(r))),
    ),
    weapons: createSection(equipment.filter(isWeapon).map(normalizeWeapon)),
    armor: createSection(equipment.filter((e) => !isWeapon(e)).map(normalizeArmor)),
    spells: createSection(read('spells.json', RawSpell).map(normalizeSpell)),
  };
  return cached;
}
