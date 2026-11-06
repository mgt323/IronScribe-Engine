/**
 * End-to-end sessions with the live model: prose in, spawns, a whole fight driven by a
 * scripted player policy, then the closing state. Not asserted turn by turn: the audit
 * checks every turn, the policy scores the model's reading (target, weapon), and the
 * case checks that the fight ended in one of the three legal ways.
 */
import {
  HERO,
  allFacts,
  attitude,
  countKey,
  encounter,
  factsOf,
  hp,
  livingHostiles,
  ofKind,
  others,
  rules,
  says,
  setHp,
} from '../lib/driver.mjs';
import { fight, legalEnd } from '../lib/policy.mjs';

export const E2E_CASES = [
  {
    id: 'e2e-wolf-pack',
    category: 'e2e',
    tier: 'full',
    heroHp: 60,
    about: 'Three wolves attack. The hero fights on with dagger and bow until the fight ends.',
    steps: async (ctx) => {
      await ctx.send('Three wolves burst from the trees and rush at me.');
      ctx.notes.result = await fight(ctx, { maxTurns: 14 });
    },
    check: (ctx) =>
      rules(
        [ofKind(ctx, 'wolf').length === 3, `wolves: ${ofKind(ctx, 'wolf').length}`],
        [legalEnd(ctx, ctx.notes.result.end), 'illegal end'],
        [countKey(ctx, 'initiative') === 4, `initiative lines ${countKey(ctx, 'initiative')}`],
        [ctx.notes.result.end !== 'cap', `no result after ${ctx.notes.result.turns} turns`],
      ),
  },
  {
    id: 'e2e-bear-multiattack',
    category: 'e2e',
    tier: 'full',
    heroHp: 60,
    about:
      'A brown bear (Multiattack) in prose; the fight must resolve with each bear turn two attacks.',
    steps: async (ctx) => {
      await ctx.send('A brown bear rears up in the cave mouth and charges me.');
      ctx.notes.result = await fight(ctx, { maxTurns: 14 });
    },
    check: (ctx) => {
      const npc = allFacts(ctx).filter((f) => f.key === 'npc_attack').length;
      return rules(
        [ofKind(ctx, 'brown-bear').length === 1, 'bear not spawned'],
        [legalEnd(ctx, ctx.notes.result.end), 'illegal end'],
        // Every bear turn is two attacks, unless the hero fell between them.
        [npc % 2 === 0 || ctx.notes.result.end === 'down', `odd bear attack count ${npc}`],
      );
    },
  },
  {
    id: 'e2e-bystanders-stay-out',
    category: 'e2e',
    tier: 'full',
    heroHp: 60,
    about:
      'Friendly guard, neutral cultist, two hostile goblins. Only the goblins fight and are fought.',
    steps: async (ctx) => {
      await ctx.send('A friendly guard waves at me from the gate.');
      await ctx.send('A cultist sits by the road, paying me no attention.');
      await ctx.send('Two goblins jump out of the ditch with drawn blades.');
      ctx.notes.result = await fight(ctx, { maxTurns: 14 });
    },
    check: (ctx) => {
      const bystanders = others(ctx).filter((e) => attitude(e) !== 'hostile');
      return rules(
        [
          ofKind(ctx, 'goblin-warrior').length === 2,
          `goblins: ${ofKind(ctx, 'goblin-warrior').length}`,
        ],
        [bystanders.length === 2, `bystanders: ${bystanders.length}`],
        [bystanders.every((b) => b.hp.current === b.hp.max), 'a bystander was hurt'],
        [legalEnd(ctx, ctx.notes.result.end), 'illegal end'],
      );
    },
  },
  {
    id: 'e2e-hero-falls',
    category: 'e2e',
    tier: 'full',
    heroHp: 4,
    about:
      'A frail hero against goblins. If they fall, later input rolls death saves: nobody attacks and the goblins are untouched.',
    steps: async (ctx) => {
      await ctx.send('Two goblins jump out of the ditch with drawn blades.');
      ctx.notes.result = await fight(ctx, { maxTurns: 10 });
      if (ctx.notes.result.end !== 'down') ctx.inconclusive('hero survived');
      ctx.notes.goblins = JSON.stringify(ofKind(ctx, 'goblin-warrior'));
      await ctx.send('I get up and swing at the goblin.');
      await ctx.send('I try to run away.');
    },
    check: (ctx) => {
      // Each later turn is a death save (or nothing, once the hero is dead). Never an attack.
      const later = says(ctx).slice(-2);
      const keys = later.flatMap((t) => factsOf(t).map((f) => f.key));
      return rules(
        [ctx.notes.goblins === JSON.stringify(ofKind(ctx, 'goblin-warrior')), 'a goblin changed'],
        [!keys.includes('attack') && !keys.includes('npc_attack'), 'someone attacked'],
        [
          later.every(
            (t) => factsOf(t).some((f) => f.key === 'death_save') || t.result.status === 'none',
          ),
          'a turn after the fall was neither a death save nor "none"',
        ],
        [encounter(ctx) !== null || hp(ctx, HERO) > 0, 'encounter ended with the hero still down'],
      );
    },
  },
  {
    id: 'e2e-two-fights',
    category: 'e2e',
    tier: 'full',
    heroHp: 100,
    about: 'Fight 1 to victory, then a second ambush: fresh initiative covers only the living.',
    steps: async (ctx) => {
      await ctx.send('A goblin leaps onto the road and attacks me.');
      setHp(ctx, 'goblin_warrior_1', 1);
      ctx.notes.first = await fight(ctx, { maxTurns: 10 });
      if (ctx.notes.first.end !== 'victory') ctx.inconclusive('first fight did not end');
      ctx.notes.initBefore = countKey(ctx, 'initiative');
      await ctx.send('Two wolves slink out of the brush toward me.');
      ctx.notes.second = await fight(ctx, { maxTurns: 14 });
    },
    check: (ctx) =>
      rules(
        [ofKind(ctx, 'wolf').length === 2, `wolves: ${ofKind(ctx, 'wolf').length}`],
        [
          countKey(ctx, 'initiative') - ctx.notes.initBefore === 3,
          `second fight rolled ${countKey(ctx, 'initiative') - ctx.notes.initBefore} lines, expected hero + 2 wolves`,
        ],
        [legalEnd(ctx, ctx.notes.second.end), 'illegal end after fight two'],
        [livingHostiles(ctx).every((e) => !e.id.startsWith('goblin')), 'dead goblin back in play'],
      ),
  },
  {
    id: 'e2e-undo-mid-fight',
    category: 'e2e',
    tier: 'full',
    heroHp: 100,
    about: 'Two fight turns, /undo, then fight on: the session stays coherent and ends legally.',
    steps: async (ctx) => {
      await ctx.send('Two goblins jump out of the ditch with drawn blades.');
      await fight(ctx, { maxTurns: 2 });
      await ctx.send('/undo');
      ctx.notes.result = await fight(ctx, { maxTurns: 14 });
    },
    check: (ctx) =>
      rules(
        [ofKind(ctx, 'goblin-warrior').length === 2, 'goblin count after undo'],
        [legalEnd(ctx, ctx.notes.result.end), 'illegal end after undo'],
      ),
  },
];
