import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedLlmClient, toFlatJsonSchema } from '@iron-scribe/llm';
import {
  PROJECT_DEFAULT_CHECK_DC,
  loadCatalog,
  proficiencyBonus,
  readConditions,
  readCreature,
} from '@iron-scribe/system-dnd5e-2024';
import { describe, expect, it } from 'vitest';

import {
  characterIdentitySchema,
  createCliSession,
  defaultAdventurerSheet,
  formatCharacterSheet,
  handleCliLine,
  suggestCharacterIdentity,
  type LineWriter,
} from './index.js';

const intent = (value: Record<string, unknown>) => JSON.stringify(value);
const idle = {
  spawnIsNew: true,
  spawn1Query: null,
  spawn1Count: null,
  spawn1Attitude: null,
  spawn2Query: null,
  spawn2Count: null,
  spawn2Attitude: null,
  spawn3Query: null,
  spawn3Count: null,
  spawn3Attitude: null,
  checkAbility: null,
  checkSkill: null,
  wantsAction: false,
};

function jsonField(raw: string | undefined, key: string): unknown {
  const parsed: unknown = JSON.parse(raw ?? '{}');
  if (typeof parsed !== 'object' || parsed === null || !Object.hasOwn(parsed, key))
    return undefined;
  return (parsed as Record<string, unknown>)[key];
}

function writer(): LineWriter & { text: () => string } {
  let text = '';
  return {
    write(chunk: string) {
      text += chunk;
    },
    text: () => text,
  };
}

describe('cli play', () => {
  it('keeps identity to a name and a backstory', async () => {
    const schema = toFlatJsonSchema('character_identity', characterIdentitySchema);
    expect(schema.jsonSchema['additionalProperties']).toBe(false);
    expect(schema.jsonSchema['required']).toEqual(['name', 'backstory']);
    const llm = createScriptedLlmClient([
      { text: JSON.stringify({ name: 'Nyx', backstory: 'Quiet.' }) },
    ]);
    await expect(suggestCharacterIdentity(llm, 'quiet')).resolves.toEqual({
      name: 'Nyx',
      backstory: 'Quiet.',
    });
  });

  it('plays the armory scene without treating stealth as Hide', async () => {
    const catalog = loadCatalog();
    const sheet = defaultAdventurerSheet();
    expect(sheet.hpMax).toBe(10);
    expect(proficiencyBonus(sheet.level)).toBe(2);
    expect(sheet.weapons).toEqual(['dagger', 'shortbow']);
    expect(sheet.skillProficiencies.filter((skill) => skill.expertise)).toHaveLength(2);
    expect(PROJECT_DEFAULT_CHECK_DC).toBe(12);

    const llm = createScriptedLlmClient([
      { text: intent({ ...idle, wantsAction: true }) },
      {
        text: intent({
          ...idle,
          spawn1Query: 'dragon',
          spawn1Count: 1,
          spawn1Attitude: 'hostile',
        }),
      },
      {
        text: intent({
          ...idle,
          spawn1Query: 'goblin warrior',
          spawn1Count: 1,
          spawn1Attitude: 'hostile',
        }),
      },
      { text: 'A goblin warrior is here.' },
      {
        text: intent({
          ...idle,
          checkAbility: 'dex',
          checkSkill: 'stealth',
          wantsAction: true,
        }),
      },
      {
        text: intent({
          kind: 'action',
          actionAlias: 'A1',
          targetAlias: 'T1',
          secondaryTargetAlias: null,
          tertiaryTargetAlias: null,
        }),
      },
      { text: 'Steel flashes.' },
    ]);
    const session = createCliSession({
      seed: 'armory',
      character: sheet,
      characterName: 'Nyx',
      backstory: 'A quiet knife.',
      llm,
      catalog,
    });
    const engine = session.orchestrator.engine;
    const hero = engine.state.entities['hero'];
    if (!hero) throw new Error('missing hero');
    expect(hero.hp).toEqual({ current: 10, max: 10 });
    expect(readCreature(hero, catalog).ac).toBe(14);
    const sheetText = formatCharacterSheet(hero, catalog, session.backstory);
    expect(sheetText).toContain('Level 1 Rogue');
    expect(sheetText).toContain('Hit Die d8');
    expect(sheetText).toContain('HP 10/10');
    expect(sheetText).toContain('Proficiency Bonus +2');
    expect(sheetText).toContain('DEX +5');
    expect(sheetText).toContain('INT +3');
    expect(sheetText).toContain('Stealth (Expertise)');
    expect(sheetText).toContain('Sleight of Hand (Expertise)');
    expect(sheetText).toContain('Perception');
    expect(sheetText).toContain('Investigation');

    const out = writer();
    await handleCliLine(session, 'I stab the goblin.', out);
    const missed = session.orchestrator.logs.at(-1);
    expect(jsonField(missed?.rawResponses[0], 'wantsAction')).toBe(true);
    // No target in the scene: the model is not asked to choose an action.
    expect(missed?.rawResponses).toHaveLength(1);
    expect(missed?.status).toBe('none');
    expect(session.orchestrator.canUndoTurn).toBe(false);

    const clarifyOut = writer();
    await handleCliLine(session, 'I enter the old armory. There is a dragon inside.', clarifyOut);
    expect(session.orchestrator.logs.at(-1)?.status).toBe('clarify');
    expect(clarifyOut.text()).toContain('dragon');
    expect(session.orchestrator.canUndoTurn).toBe(false);
    expect(engine.commits).toHaveLength(1);

    await handleCliLine(session, 'I enter the old armory. There is a goblin warrior inside.', out);
    const goblin = engine.state.entities['goblin_warrior_1'];
    if (!goblin) throw new Error('missing goblin');
    expect(goblin.hp).toEqual({ current: 10, max: 10 });
    expect(readCreature(goblin, catalog).ac).toBe(15);
    const menu = engine.menu('hero');
    expect(menu.actions[0]?.actionId).toBe('weapon:dagger');
    expect(menu.targets[0]?.entityId).toBe('goblin_warrior_1');

    const rngBefore = engine.state.rng;
    await handleCliLine(session, 'I sneak up and stab the goblin.', out);
    const sneak = session.orchestrator.logs.at(-1);
    expect(sneak?.facts.map((fact) => fact.text).join('\n')).toMatch(
      /Stealth \d+ vs DC 12, (success|failure)/,
    );
    expect(sneak?.facts.map((fact) => fact.text).join('\n')).toMatch(
      /vs AC 15, (hit|miss|critical hit)/,
    );
    expect(sneak?.commits.some((commit) => commit.request?.actionAlias === 'A1')).toBe(true);
    expect(
      sneak?.commits.some((commit) =>
        commit.events.some((event) => event.type === 'entity.systemDataSet'),
      ),
    ).toBe(false);
    expect(readConditions(hero).ids).not.toContain('invisible');
    expect(out.text()).toContain('Steel flashes.');
    const hpAfter = engine.state.entities['goblin_warrior_1']?.hp.current;
    const rngAfter = sneak?.rngAfter;

    await handleCliLine(session, '/undo', out);
    expect(engine.state.entities['goblin_warrior_1']?.hp).toEqual({ current: 10, max: 10 });
    expect(engine.state.rng).toEqual(rngBefore);
    await handleCliLine(session, '/redo', out);
    expect(engine.state.rng).toEqual(rngAfter);
    expect(engine.state.entities['goblin_warrior_1']?.hp.current).toBe(hpAfter);
  });

  it('keeps redo across a clarification and writes a save without credentials', async () => {
    const catalog = loadCatalog();
    const llm = createScriptedLlmClient([
      {
        text: intent({ ...idle, spawn1Query: 'wolf', spawn1Count: 1, spawn1Attitude: 'hostile' }),
      },
      { text: 'A wolf pads in.' },
      {
        text: intent({ ...idle, spawn1Query: 'dragon', spawn1Count: 1, spawn1Attitude: 'hostile' }),
      },
    ]);
    const session = createCliSession({
      seed: 'redo',
      character: defaultAdventurerSheet(),
      characterName: 'Nyx',
      llm,
      catalog,
    });
    const out = writer();
    await handleCliLine(session, 'A wolf.', out);
    expect(session.orchestrator.engine.state.entities['wolf_1']).toBeTruthy();
    await handleCliLine(session, '/undo', out);
    expect(session.orchestrator.canRedoTurn).toBe(true);
    expect(session.orchestrator.engine.state.entities['wolf_1']).toBeUndefined();
    await handleCliLine(session, 'A dragon.', out);
    expect(session.orchestrator.logs.at(-1)?.status).toBe('clarify');
    expect(session.orchestrator.canRedoTurn).toBe(true);
    const status = writer();
    await handleCliLine(session, '/status', status);
    expect(session.orchestrator.canRedoTurn).toBe(true);
    expect(status.text()).toContain('Nyx');
    expect(status.text()).not.toContain('wolf_1');

    const dir = mkdtempSync(join(tmpdir(), 'iron-scribe-'));
    const path = join(dir, 'save.json');
    try {
      await handleCliLine(session, `/save ${path}`, out);
      const saved = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
      expect(Object.keys(saved).sort()).toEqual(
        ['actorId', 'backstory', 'characterName', 'commits', 'logs', 'seed', 'state'].sort(),
      );
      expect(JSON.stringify(saved)).not.toMatch(/apiKey|GEMINI|sk-/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    await expect(handleCliLine(session, '/quit', out)).resolves.toBe(true);
    await handleCliLine(session, '/nope', out);
    expect(out.text()).toContain('Unknown command');
  });
});
