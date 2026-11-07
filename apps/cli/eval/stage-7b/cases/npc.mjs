/**
 * 7B.3 NPC side: recharge, Multiattack variants, Hydra heads and the tactical policy. The
 * model only picks the hero's attack and tells the story; the monsters act by engine policy.
 * Turn order is pinned and the hero has plenty of HP, so the hero outlasts the scenario.
 */
import {
  HERO,
  allFacts,
  factsOf,
  hp,
  hydraHeads,
  pinOrder,
  rules,
  says,
  setHp,
  setHydra,
  spawn,
} from '../lib/driver.mjs';

const base = { category: 'npc', tier: 'engine', heroHp: 300 };
const count = (facts, key) => facts.filter((f) => f.key === key).length;

export const NPC_CASES = [
  {
    ...base,
    id: 'npc-dragon-breath-recharge',
    about:
      'Young Red Dragon with two friendly guards beside the hero: Fire Breath (save action, three targets) is used, then rolled for at the start of each later dragon turn; it is never used while expended. (Against one target the policy prefers Multiattack.)',
    steps: async (ctx) => {
      await spawn(ctx, 'young red dragon');
      await spawn(ctx, 'guard 2 friendly');
      pinOrder(ctx, [HERO, 'young_red_dragon_1', 'guard_1', 'guard_2']);
      for (let i = 0; i < 8; i += 1) {
        await ctx.send('I stab the dragon with my dagger.');
        const used = allFacts(ctx).some((f) => f.key === 'use' && /Fire Breath/.test(f.text));
        const rolled = allFacts(ctx).some((f) => f.key === 'recharge');
        if (used && rolled) break;
      }
      if (!allFacts(ctx).some((f) => f.key === 'use' && /Fire Breath/.test(f.text)))
        ctx.inconclusive('the dragon never chose Fire Breath');
    },
    check: (ctx) => {
      const facts = allFacts(ctx);
      const rolls = facts.filter((f) => f.key === 'recharge');
      return rules(
        [rolls.length >= 1, 'Fire Breath was used but never rolled to recharge'],
        [
          rolls.every((f) => /d6=[1-6] \(needs 5\+\)/.test(f.text)),
          `recharge text: ${rolls[0]?.text}`,
        ],
        [count(facts, 'save') >= 1, 'Fire Breath produced no save fact'],
      );
    },
  },
  {
    ...base,
    id: 'npc-multiattack-bandit-captain',
    about:
      'A Multiattack creature acts as one turn of several attacks against the hero, each its own npc_attack fact.',
    steps: async (ctx) => {
      await spawn(ctx, 'bandit captain');
      pinOrder(ctx, ['bandit_captain_1', HERO]);
      await ctx.send('I stab the bandit captain with my dagger.');
    },
    check: (ctx) => {
      const [t] = says(ctx);
      const attacks = factsOf(t).filter((f) => f.key === 'npc_attack');
      const used = factsOf(t).some((f) => f.key === 'use' && /Multiattack/.test(f.text));
      return rules(
        [attacks.length >= 2, `${attacks.length} npc attacks in the captain's turn`],
        [
          attacks.every((f) => f.text.startsWith('Bandit Captain (')),
          'an attack fact is not labelled',
        ],
        [used || attacks.length >= 2, 'no Multiattack fact'],
      );
    },
  },
  {
    ...base,
    id: 'npc-hydra-loses-and-regrows-heads',
    about:
      'Hydra at 24 damage this turn: one more hit costs a head (hero acts first); the hydra bites once per head it has left, then regrows two heads and 20 HP.',
    steps: async (ctx) => {
      await spawn(ctx, 'hydra');
      pinOrder(ctx, [HERO, 'hydra_1']);
      for (let i = 0; i < 6; i += 1) {
        // Fire would stop the regrowth, so the rogue (no fire) is the right hero for this case.
        setHp(ctx, 'hydra_1', ctx.state().entities.hydra_1.hp.max - 30);
        setHydra(ctx, 'hydra_1', { damageThisTurn: 24 });
        await ctx.send('I stab the hydra with my dagger.');
        if (allFacts(ctx).some((f) => f.key === 'hydra' && /loses a head/.test(f.text))) return;
      }
      ctx.inconclusive('no dagger hit landed in six tries');
    },
    check: (ctx) => {
      const t = says(ctx).at(-1);
      const bites = factsOf(t).filter((f) => f.key === 'npc_attack').length;
      const grows = factsOf(t).find((f) => f.key === 'hydra' && /grows 2 heads/.test(f.text));
      return rules(
        [!!grows, 'the hydra did not regrow two heads'],
        [bites === 4, `${bites} bites, expected 4 (one per head left)`],
        [hydraHeads(ctx, 'hydra_1') === 6, `${hydraHeads(ctx, 'hydra_1')} heads, expected 6`],
        [/regains \d+ HP/.test(grows?.text ?? ''), 'regrowth did not heal'],
      );
    },
  },
  {
    ...base,
    id: 'npc-policy-lowest-hp-target',
    about:
      'A hostile wolf with the hero (full HP) and a friendly guard at 1 HP in reach goes for the guard, not the hero.',
    steps: async (ctx) => {
      // Wolf spawns first, so the hero's alias (T1) survives the guard falling. The wolf acts once,
      // after the hero (a wolf ahead of the hero would act twice around the guard's skipped turn).
      await spawn(ctx, 'wolf');
      await spawn(ctx, 'guard 1 friendly');
      setHp(ctx, 'guard_1', 1);
      pinOrder(ctx, [HERO, 'wolf_1', 'guard_1']);
      const heroBefore = hp(ctx, HERO);
      await ctx.send('I stab the wolf with my dagger.');
      ctx.notes.heroHurt = hp(ctx, HERO) < heroBefore;
      ctx.notes.guardHurt = hp(ctx, 'guard_1') < 1;
      const wolfAttacked = factsOf(says(ctx)[0]).some((f) => f.key === 'npc_attack');
      if (!wolfAttacked || !(ctx.notes.heroHurt || ctx.notes.guardHurt))
        ctx.inconclusive('the wolf missed');
    },
    check: (ctx) =>
      rules(
        [ctx.notes.guardHurt, 'the wolf did not hurt the 1 HP guard'],
        [!ctx.notes.heroHurt, 'the wolf hurt the hero instead of the weakest target'],
      ),
  },
  {
    ...base,
    id: 'npc-alias-survives-friend-falling',
    about:
      "Guard (T1) at 1 HP, wolf (T2), wolf acts first and kills the guard: the hero's attack on the wolf must still land on the wolf.",
    steps: async (ctx) => {
      await spawn(ctx, 'guard 1 friendly');
      await spawn(ctx, 'wolf');
      setHp(ctx, 'guard_1', 1);
      pinOrder(ctx, ['wolf_1', HERO, 'guard_1']);
      try {
        await ctx.send('I stab the wolf with my dagger.', { target: 'wolf_1' });
      } catch (e) {
        ctx.notes.error = e instanceof Error ? e.message : String(e);
        return;
      }
      if (hp(ctx, 'guard_1') > 0) ctx.inconclusive('the wolf did not kill the guard');
    },
    check: (ctx) =>
      rules(
        [!ctx.notes.error, `the turn failed: ${ctx.notes.error}`],
        [
          (says(ctx).at(-1) ? factsOf(says(ctx).at(-1)) : []).some((f) => f.key === 'attack'),
          'the hero made no attack on the wolf',
        ],
      ),
  },
];
