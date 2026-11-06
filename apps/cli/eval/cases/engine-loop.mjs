/**
 * 7A engine loop, tier "engine": monsters come from /spawn, so the model only chooses
 * the player's action and tells the story. Isolates the combat loop from spawn quality.
 * Controlled-dice cases pin HP and turn order with engine setup commits.
 */
import {
  HERO,
  allFacts,
  attitude,
  cmdOut,
  countKey,
  encounter,
  factsOf,
  heroAim,
  hp,
  ofKind,
  others,
  pinOrder,
  rules,
  says,
  setHp,
  spawn,
} from '../lib/driver.mjs';

const ATTACK = 'I stab the wolf with my dagger.';

export const ENGINE_CASES = [
  {
    id: 'loop-one-initiative',
    category: 'loop',
    tier: 'engine',
    heroHp: 80,
    about:
      'First attack on a hostile rolls initiative once for hero + each creature, then never again.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 2');
      await ctx.send(ATTACK);
      await ctx.send('I attack the wolf again.');
    },
    check: (ctx) =>
      rules(
        [countKey(ctx, 'initiative') === 3, `initiative lines: ${countKey(ctx, 'initiative')}`],
        [
          factsOf(says(ctx)[1]).every((f) => f.key !== 'initiative'),
          'second turn re-rolled initiative',
        ],
        [encounter(ctx)?.round === 3, `round ${encounter(ctx)?.round}, expected 3`],
      ),
  },
  {
    id: 'loop-group-initiative',
    category: 'loop',
    tier: 'engine',
    heroHp: 80,
    about: 'Identical monsters share one d20; ties then break by DEX, player, spawn order.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 3');
      await ctx.send(ATTACK);
    },
    check: (ctx) => {
      const order = encounter(ctx)?.order ?? [];
      const wolves = order.filter((o) => o.entityId.startsWith('wolf'));
      return rules(
        [wolves.length === 3, `wolves in order: ${wolves.length}`],
        [new Set(wolves.map((w) => w.total)).size === 1, 'wolves did not share a roll'],
        [
          countKey(ctx, 'initiative') === 4,
          `expected 4 initiative lines, got ${countKey(ctx, 'initiative')}`,
        ],
      );
    },
  },
  {
    id: 'loop-player-first-pinned',
    category: 'loop',
    tier: 'engine',
    heroHp: 80,
    about: 'Order pinned [hero, wolf]: hero attack fact comes before the wolf attack fact.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf');
      pinOrder(ctx, [HERO, 'wolf_1']);
      await ctx.send(ATTACK, { target: 'wolf_1' });
    },
    check: (ctx) => {
      const keys = allFacts(ctx).map((f) => f.key);
      const e = encounter(ctx);
      return rules(
        [keys.indexOf('attack') !== -1, 'hero did not attack'],
        [keys.indexOf('attack') < keys.indexOf('npc_attack'), 'wolf acted before the hero'],
        [!keys.includes('initiative'), 'pinned encounter rolled initiative again'],
        [!e || (e.round === 2 && e.turnIndex === 0), `loop left ${JSON.stringify(e)}`],
      );
    },
  },
  {
    id: 'loop-npc-first-pinned',
    category: 'loop',
    tier: 'engine',
    heroHp: 80,
    about: 'Order pinned [wolf, hero]: the wolf attacks before the hero, once per round.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf');
      pinOrder(ctx, ['wolf_1', HERO]);
      await ctx.send(ATTACK, { target: 'wolf_1' });
    },
    check: (ctx) => {
      const keys = allFacts(ctx).map((f) => f.key);
      return rules(
        [keys.indexOf('npc_attack') === 0, `first fact was ${keys[0]}`],
        [keys.filter((k) => k === 'npc_attack').length <= 2, 'wolf acted more than once a round'],
        [
          allFacts(ctx)[0].text.startsWith('Wolf ('),
          `npc fact not labelled: ${allFacts(ctx)[0].text}`,
        ],
      );
    },
  },
  {
    id: 'loop-rounds-count',
    category: 'loop',
    tier: 'engine',
    heroHp: 100,
    about: 'Round counter rises by one per hero action across five turns of a three-wolf fight.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 3');
      for (let i = 0; i < 5; i += 1) await ctx.send('I attack the wolves with my dagger.');
    },
    check: (ctx) => {
      const e = encounter(ctx);
      const heroTurns = says(ctx).filter((t) => heroAim(t)).length;
      return e
        ? rules([e.round === heroTurns + 1, `round ${e.round} after ${heroTurns} hero actions`])
        : true;
    },
  },
  {
    id: 'loop-bystander-skips',
    category: 'loop',
    tier: 'engine',
    heroHp: 80,
    about:
      'A friendly NPC in a fight takes no hostile action, is never hurt, and does not end combat.',
    steps: async (ctx) => {
      await spawn(ctx, 'guard 1 friendly');
      await spawn(ctx, 'wolf');
      await ctx.send(ATTACK, { target: 'wolf_1' });
      await ctx.send(ATTACK, { target: 'wolf_1' });
    },
    check: (ctx) => {
      const guard = others(ctx).find((e) => e.id.startsWith('guard'));
      return rules(
        [!!guard, 'guard missing'],
        [attitude(guard) === 'friendly', 'guard attitude changed'],
        [guard.hp.current === guard.hp.max, 'guard was hurt'],
        [
          !allFacts(ctx).some((f) => f.key === 'npc_attack' && /guard/i.test(f.text)),
          'guard attacked',
        ],
      );
    },
  },
  {
    id: 'loop-multiattack-bear',
    category: 'loop',
    tier: 'engine',
    heroHp: 120,
    about:
      'Brown Bear Multiattack (Bite + Claw) is expanded by the engine: two npc_attack facts per bear turn.',
    steps: async (ctx) => {
      await spawn(ctx, 'brown-bear');
      pinOrder(ctx, ['brown_bear_1', HERO]);
      await ctx.send('I attack the bear with my dagger.', { target: 'brown_bear_1' });
    },
    check: (ctx) => {
      const npc = allFacts(ctx).filter((f) => f.key === 'npc_attack');
      return rules(
        [npc.length >= 2, `expected 2 sequential bear attacks, got ${npc.length}`],
        [npc.slice(0, 2).every((f) => f.text.startsWith('Brown Bear (')), 'bear facts mislabelled'],
        [
          new Set(npc.slice(0, 2).map((f) => f.text.match(/\): (\w+):/)?.[1])).size === 2,
          'bear used one attack twice',
        ],
        [ofKind(ctx, 'brown-bear').length === 1, 'bear count'],
      );
    },
  },
  {
    id: 'loop-multiattack-stops-at-zero',
    category: 'loop',
    tier: 'engine',
    heroHp: 1,
    about: 'Hero at 1 HP, bear first in order: sub-attacks stop once the hero is down.',
    steps: async (ctx) => {
      await spawn(ctx, 'brown-bear');
      pinOrder(ctx, ['brown_bear_1', HERO]);
      await ctx.send('I attack the bear with my dagger.');
      if (hp(ctx, HERO) > 0) ctx.inconclusive('bear missed both attacks');
    },
    check: (ctx) => {
      const facts = allFacts(ctx);
      const fell = facts.findIndex(
        (f) => f.key === 'condition' && f.text === `${HERO} unconscious`,
      );
      const after = facts
        .slice(fell + 1)
        .filter((f) => f.key === 'attack' || f.key === 'npc_attack');
      return rules(
        [fell !== -1, 'hero never fell'],
        [after.length === 0, `${after.length} attacks resolved after the hero fell`],
      );
    },
  },
  {
    id: 'loop-hero-down-dying',
    category: 'loop',
    tier: 'engine',
    heroHp: 12,
    about:
      'Hero at 0 HP with hostiles alive: the next input is a death save (no model decision), hostiles hold, the wolves are untouched.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 3');
      // 12 HP so a bite cannot kill outright (massive damage); pinned to 1 so one hit drops the hero.
      setHp(ctx, HERO, 1);
      pinOrder(ctx, ['wolf_1', 'wolf_2', 'wolf_3', HERO]);
      await ctx.send(ATTACK);
      if (hp(ctx, HERO) > 0) ctx.inconclusive('three wolves all missed');
      ctx.notes.wolves = JSON.stringify(ofKind(ctx, 'wolf'));
      await ctx.send('I attack the wolf.');
      await ctx.send('/status');
    },
    check: (ctx) => {
      const last = says(ctx).at(-1);
      const keys = factsOf(last).map((f) => f.key);
      return rules(
        [encounter(ctx) !== null, 'encounter ended with hostiles alive'],
        [keys.includes('death_save'), `no death save after the fall (${keys.join(',')})`],
        [!keys.includes('npc_attack'), 'NPC attacked a dying hero'],
        [!keys.includes('attack'), 'a dying hero attacked'],
        [ctx.notes.wolves === JSON.stringify(ofKind(ctx, 'wolf')), 'a wolf changed'],
        [/DYING/.test(cmdOut(ctx, '/status')), '/status does not say DYING'],
      );
    },
  },
  {
    id: 'loop-down-before-act',
    category: 'loop',
    tier: 'engine',
    heroHp: 1,
    about:
      'The hero falls to a faster NPC before their action: the queued attack is skipped, not resolved.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin-warrior 3');
      pinOrder(ctx, ['goblin_warrior_1', 'goblin_warrior_2', 'goblin_warrior_3', HERO]);
      await ctx.send('I attack the goblin with my dagger.');
      if (hp(ctx, HERO) > 0) ctx.inconclusive('goblins all missed');
    },
    check: (ctx) =>
      rules(
        [!allFacts(ctx).some((f) => f.key === 'attack'), 'hero attack resolved after falling'],
        [
          ofKind(ctx, 'goblin-warrior').every((g) => g.hp.current === g.hp.max),
          'a goblin lost hp to a fallen hero',
        ],
      ),
  },
  {
    id: 'loop-victory-ends-encounter',
    category: 'loop',
    tier: 'engine',
    heroHp: 100,
    about:
      'Last hostile falls: encounter clears, /status shows no combat, a new spawn is accepted.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin-warrior');
      setHp(ctx, 'goblin_warrior_1', 1);
      for (let i = 0; i < 8 && hp(ctx, 'goblin_warrior_1') > 0; i += 1)
        await ctx.send('I stab the goblin with my dagger.');
      if (hp(ctx, 'goblin_warrior_1') > 0) ctx.inconclusive('hero missed eight times');
      await ctx.send('/status');
      await spawn(ctx, 'wolf');
    },
    check: (ctx) =>
      rules(
        [encounter(ctx) === null, 'encounter survived victory'],
        [!/Combat:/.test(cmdOut(ctx, '/status')), '/status still shows combat'],
        [ofKind(ctx, 'wolf').length === 1, 'spawn refused after the fight ended'],
      ),
  },
  {
    id: 'loop-undo-whole-turn',
    category: 'loop',
    tier: 'engine',
    heroHp: 80,
    about: '/undo after a combat turn restores state, encounter and RNG exactly; /redo returns.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 2');
      const before = JSON.stringify(ctx.state());
      await ctx.send(ATTACK);
      const after = JSON.stringify(ctx.state());
      await ctx.send('/undo');
      ctx.notes.undone = JSON.stringify(ctx.state()) === before;
      await ctx.send('/redo');
      ctx.notes.redone = JSON.stringify(ctx.state()) === after;
    },
    check: (ctx) =>
      rules(
        [ctx.notes.undone, '/undo did not restore the pre-turn state'],
        [ctx.notes.redone, '/redo diverged'],
      ),
  },
];
