#!/usr/bin/env node
/**
 * Smoke check for the Stage 4 rules. Build first:
 *
 *   pnpm build
 *   pnpm --filter @iron-scribe/system-dnd5e-2024 rules
 *
 * Spawns a dagger-wielding character and a Goblin Warrior, then runs
 * initiative, an attack, a save and a skill check. The same seed must
 * replay, and undo must return to the empty scene.
 */
import { createEngine, createInitialState, replay } from '@iron-scribe/engine-core';

import {
  applyDefenses,
  characterToEntity,
  createDnd5eSystem,
  loadCatalog,
  monsterToEntity,
  readCreature,
  weaponAttackBonus,
} from '../dist/index.js';

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok, detail });

const catalog = loadCatalog();
const system = createDnd5eSystem({ catalog });

const must = (section, id) => {
  const entry = section.get(id);
  if (!entry) throw new Error(`missing ${id}`);
  return entry;
};

const sheet = {
  level: 1,
  abilities: { str: 8, dex: 16, con: 14, int: 10, wis: 12, cha: 10 },
  saveProficiencies: ['dex'],
  skillProficiencies: [{ skill: 'stealth', expertise: false }],
  weaponProficiencies: ['simple'],
  weapons: ['dagger'],
  armor: 'leather-armor',
  shield: false,
  hpMax: 12,
};

const hero = characterToEntity(sheet, 'hero', { name: 'Hero' });
const goblin = monsterToEntity(must(catalog.monsters, 'goblin-warrior'), 'goblin_1');
const heroView = readCreature(hero, catalog);
const goblinView = readCreature(goblin, catalog);

check('leather armor AC is 11 + Dexterity', heroView.ac === 14, String(heroView.ac));
check('Goblin Warrior AC is the stat block', goblinView.ac === 15, String(goblinView.ac));
check(
  'a proficient finesse dagger uses Dexterity',
  weaponAttackBonus(sheet, must(catalog.weapons, 'dagger')).bonus === 5,
  '',
);

const skeleton = readCreature(monsterToEntity(must(catalog.monsters, 'skeleton'), 's'), catalog);
check(
  'skeleton: poison immunity, then bludgeoning vulnerability',
  applyDefenses([{ type: 'poison', amount: 5 }], skeleton)[0]?.amount === 0 &&
    applyDefenses([{ type: 'bludgeoning', amount: 5 }], skeleton)[0]?.amount === 10,
  '',
);

const down = characterToEntity(sheet, 'down', { name: 'Down' });
const unconscious = {
  ...down,
  system: { ...down.system, conditions: { ids: ['unconscious'], exhaustion: 0 } },
};
const quiet = createEngine({ system, initialState: createInitialState({ seed: 1 }) });
quiet.commit('down', [{ type: 'entity.spawned', entity: unconscious }]);
check('an unconscious character has no actions', quiet.menu('down').actions.length === 0, '');

function runScene(seed) {
  const initial = createInitialState({ seed });
  const engine = createEngine({ system, initialState: initial });
  engine.commit('spawn', [
    { type: 'entity.spawned', entity: hero },
    { type: 'entity.spawned', entity: goblin },
  ]);
  const initiative = engine.runProcedure('initiative', {
    kind: 'initiative',
    surprised: ['hero'],
  });
  const menu = engine.menu('hero');
  const goblinMenu = engine.menu('goblin_1');
  const action = menu.actions[0];
  const target = menu.targets[0];
  if (!action || !target) throw new Error('hero has no attack');
  const attack = engine.perform({
    actorId: 'hero',
    actionAlias: action.alias,
    targetAlias: target.alias,
  });
  const save = engine.runProcedure('save', {
    kind: 'save',
    actorId: 'hero',
    ability: 'dex',
    dc: 13,
  });
  const stealth = engine.runProcedure('check', {
    kind: 'check',
    actorId: 'hero',
    ability: 'dex',
    skill: 'stealth',
    dc: 12,
  });
  return { initial, engine, initiative, menu, goblinMenu, attack, save, stealth };
}

const scene = runScene('stage4');
const { engine, menu, goblinMenu, attack, save, stealth } = scene;
const encounter = engine.state.system.encounter;

check(
  'hero menu is the dagger against the goblin',
  menu.actions.map((action) => action.actionId).join(',') === 'weapon:dagger' &&
    menu.targets.map((target) => target.entityId).join(',') === 'goblin_1',
  menu.actions.map((action) => action.label).join(', '),
);
check(
  'goblin menu is Scimitar and Shortbow',
  goblinMenu.actions.map((action) => action.actionId).join(',') ===
    'monster:scimitar,monster:shortbow',
  '',
);
check(
  'initiative writes the encounter, and surprise is disadvantage',
  encounter?.round === 1 &&
    encounter.order?.length === 2 &&
    scene.initiative.facts.some(
      (fact) => fact.text.startsWith('Hero ') && fact.text.includes('disadvantage'),
    ),
  scene.initiative.facts.map((fact) => fact.text).join('; '),
);
check(
  'the attack fact is against the goblin AC',
  attack.procedure === null &&
    attack.facts.some((fact) => fact.key === 'attack' && fact.text.includes('vs AC 15')),
  attack.facts.map((fact) => `${fact.key}: ${fact.text}`).join('; '),
);
check(
  'the save is logged as a procedure',
  save.request === null &&
    save.procedure?.kind === 'save' &&
    /^Dexterity \d+ vs DC 13, /.test(save.facts[0]?.text ?? ''),
  save.facts[0]?.text ?? '',
);
check(
  'the stealth check names the skill',
  /^Stealth \d+ vs DC 12, /.test(stealth.facts[0]?.text ?? ''),
  stealth.facts[0]?.text ?? '',
);

const before = engine.commits.length;
let rejected = '';
try {
  engine.runProcedure('nope', { kind: 'sing' });
} catch (error) {
  rejected = error?.code ?? error?.message ?? 'threw';
}
check(
  'an unknown procedure changes nothing',
  rejected === 'unknown_alias' && engine.commits.length === before,
  rejected,
);

let missing = '';
try {
  createEngine({
    system: {
      id: 'bare',
      availableActions: () => ({ actions: [], targets: [] }),
      resolve: () => ({ events: [], facts: [] }),
    },
    initialState: createInitialState({ seed: 1 }),
  }).runProcedure('x', { kind: 'noop' });
} catch (error) {
  missing = error?.code ?? '';
}
check('a system without runProcedure is refused', missing === 'no_procedure_handler', missing);

const played = engine.state;
const commits = [...engine.commits];
check(
  'replay rebuilds the scene, including the dice',
  JSON.stringify(replay(scene.initial, commits, system)) === JSON.stringify(played),
  '',
);
while (engine.canUndo) engine.undo();
check(
  'undo returns to the empty scene',
  JSON.stringify(engine.state) === JSON.stringify(scene.initial),
  '',
);
while (engine.canRedo) engine.redo();
check('redo restores the scene', JSON.stringify(engine.state) === JSON.stringify(played), '');

const again = runScene('stage4');
check(
  'the same seed plays the same scene',
  JSON.stringify(again.engine.commits) === JSON.stringify(commits),
  '',
);

console.log('scene');
for (const commit of commits) {
  if (commit.facts.length === 0) continue;
  console.log(`  ${commit.label}`);
  for (const fact of commit.facts) console.log(`    ${fact.key}: ${fact.text}`);
}
console.log('');

let failed = 0;
for (const entry of checks) {
  console.log(
    `${entry.ok ? 'ok  ' : 'FAIL'} ${entry.name}${entry.detail ? ` — ${entry.detail}` : ''}`,
  );
  if (!entry.ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} passed`);
process.exit(failed === 0 ? 0 : 1);
