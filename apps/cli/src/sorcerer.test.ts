import { createScriptedLlmClient } from '@iron-scribe/llm';
import {
  loadCatalog,
  readSlotsUsed,
  validateCharacterSpells,
} from '@iron-scribe/system-dnd5e-2024';
import { describe, expect, it } from 'vitest';

import {
  SORCERER_ALLOWLIST,
  createCliSession,
  defaultSorcererSheet,
  formatCharacterSheet,
  handleCliLine,
  isArchetype,
  type LineWriter,
} from './index.js';

const catalog = loadCatalog();

function writer(): LineWriter & { text: () => string } {
  let text = '';
  return {
    write(chunk: string) {
      text += chunk;
    },
    text: () => text,
  };
}

const intent = JSON.stringify({
  spawnIsNew: false,
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
  wantsAction: true,
});

function session(steps: { text: string }[]) {
  return createCliSession({
    seed: 'sorc',
    character: defaultSorcererSheet(),
    characterName: 'Mira',
    archetype: 'sorcerer',
    llm: createScriptedLlmClient(steps),
    catalog,
  });
}

const slotsUsed = (s: ReturnType<typeof session>) => {
  const hero = s.orchestrator.engine.state.entities['hero'];
  if (!hero) throw new Error('missing hero');
  return readSlotsUsed(hero);
};

describe('Sorcerer preset', () => {
  it('is the SRD Level 1 Sorcerer from the plan', () => {
    const sheet = defaultSorcererSheet();
    expect(sheet).toMatchObject({
      hpMax: 8,
      saveProficiencies: ['con', 'cha'],
      weapons: ['dagger', 'light-crossbow'],
      armor: null,
      spellcastingAbility: 'cha',
      spellSlots: { '1': 2 },
      abilities: { str: 8, dex: 14, con: 14, int: 12, wis: 10, cha: 16 },
    });
    expect(sheet.cantrips).toEqual(['fire-bolt', 'ray-of-frost', 'mage-hand', 'prestidigitation']);
    expect(sheet.preparedSpells).toEqual(['burning-hands', 'magic-missile']);
    expect(() => validateCharacterSpells(sheet, catalog, SORCERER_ALLOWLIST)).not.toThrow();
  });

  it('keeps Sacred Flame and Cure Wounds out, and rejects spells that are not in the catalog', () => {
    expect(SORCERER_ALLOWLIST.has('sacred-flame')).toBe(false);
    expect(SORCERER_ALLOWLIST.has('cure-wounds')).toBe(false);
    const cleric = { ...defaultSorcererSheet(), cantrips: ['sacred-flame'] };
    expect(() => validateCharacterSpells(cleric, catalog, SORCERER_ALLOWLIST)).toThrow(
      'spell not allowed: sacred-flame',
    );
    const bogus = { ...defaultSorcererSheet(), cantrips: ['no-such-spell'] };
    expect(() => validateCharacterSpells(bogus, catalog)).toThrow('unknown spell: no-such-spell');
    expect(() =>
      createCliSession({
        seed: 1,
        character: bogus,
        characterName: 'x',
        llm: createScriptedLlmClient([]),
        catalog,
      }),
    ).toThrow('unknown spell');
  });

  it('knows its archetype names', () => {
    expect(isArchetype('sorcerer')).toBe(true);
    expect(isArchetype('wizard')).toBe(false);
  });

  it('/sheet shows casting stats, spells, and the slots left', async () => {
    const s = session([{ text: 'Fire.' }]);
    const out = writer();
    await handleCliLine(s, '/sheet', out);
    expect(out.text()).toContain('Level 1 Sorcerer');
    expect(out.text()).toContain('Hit Die d6');
    expect(out.text()).toContain('Spellcasting: CHA, spell attack +5, save DC 13');
    expect(out.text()).toContain('Cantrips: Fire Bolt, Ray of Frost, Mage Hand, Prestidigitation');
    expect(out.text()).toContain('Prepared spells: Burning Hands, Magic Missile');
    expect(out.text()).toContain('Spell slots: level 1: 2/2');
    expect(out.text()).toContain('CON +4, CHA +5');
    expect(out.text()).toContain('AC 12');
    const hero = s.orchestrator.engine.state.entities['hero'];
    if (!hero) throw new Error('missing hero');
    expect(formatCharacterSheet(hero, catalog, null, 'sorcerer')).toContain('Level 1 Sorcerer');
  });
});

describe('Sorcerer in play', () => {
  it('/act A# T# T# casts an area spell on two targets, spends a slot, and undoes in one step', async () => {
    const s = session([{ text: 'Rats scurry in.' }, { text: 'Flames sweep the room.' }]);
    const out = writer();
    await handleCliLine(s, '/spawn rat 2 hostile', out);
    const menu = s.orchestrator.engine.menu('hero');
    const burning = menu.actions.find((a) => a.label === 'Burning Hands');
    expect(burning?.maxTargets).toBe(3);

    await handleCliLine(s, `/act ${burning?.alias ?? '?'} T1 T2`, out);
    expect(out.text()).toContain('hero casts Burning Hands');
    expect(out.text()).toContain('rat_1 Dexterity save');
    expect(out.text()).toContain('rat_2 Dexterity save');
    expect(slotsUsed(s)).toEqual({ '1': 1 });
    const cast = s.orchestrator.engine.commits.find(
      (c) => c.request?.actionAlias === burning?.alias,
    );
    expect(cast?.request?.targetAliases).toEqual(['T1', 'T2']);

    await handleCliLine(s, '/sheet', out);
    expect(out.text()).toContain('Spell slots: level 1: 1/2');
    await handleCliLine(s, '/undo', out);
    expect(slotsUsed(s)).toEqual({});
    await handleCliLine(s, '/redo', out);
    expect(slotsUsed(s)).toEqual({ '1': 1 });
  });

  it('rejects more than three targets and a missing target', async () => {
    const s = session([{ text: 'Rats scurry in.' }]);
    const out = writer();
    await handleCliLine(s, '/spawn rat 2 hostile', out);
    await handleCliLine(s, '/act A5 T1 T2 T3 T4', out);
    expect(out.text()).toContain('Usage: /act A# [T#] [T#] [T#]');
    await handleCliLine(s, '/act A5', out);
    expect(out.text()).toContain('A5 requires a target');
    expect(slotsUsed(s)).toEqual({});
  });

  it("turns the model's flat target fields into one targetAliases list", async () => {
    const decision = JSON.stringify({
      kind: 'action',
      actionAlias: 'A6',
      targetAlias: 'T2',
      secondaryTargetAlias: 'T1',
      tertiaryTargetAlias: null,
    });
    const s = session([
      { text: 'Rats scurry in.' },
      { text: intent },
      { text: decision },
      { text: 'Darts streak out.' },
    ]);
    const out = writer();
    await handleCliLine(s, '/spawn rat 2 hostile', out);
    await handleCliLine(s, 'I loose magic missiles at both of them', out);
    const cast = s.orchestrator.engine.commits.find((c) => c.request?.actionAlias === 'A6');
    expect(cast?.request).toMatchObject({ targetAlias: 'T2', targetAliases: ['T2', 'T1'] });
    expect(out.text()).toContain('hero casts Magic Missile');
  });
});
