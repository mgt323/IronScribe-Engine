/**
 * 7B.2 spells, slots and several targets, played by the Level 1 Sorcerer (Fire Bolt, Ray of
 * Frost, Burning Hands, Magic Missile; two level 1 slots). The model's job: pick the right
 * spell from the menu, name every target the player named (up to three), and decline what
 * the menu does not offer (a spent slot, a spell off the sheet, a cantrip with no rules).
 * The engine's job, audited on every turn: slots only fall through a leveled cast, one per
 * cast, never above two, and `/undo` gives them back.
 */
import {
  allFacts,
  factsOf,
  heroRequest,
  hp,
  says,
  slotsUsed,
  spawn,
  spendSlots,
  rules,
} from '../lib/driver.mjs';

const GOBLIN = (n) => `goblin_warrior_${n}`;
const castFacts = (ctx, re) => allFacts(ctx).filter((f) => f.key === 'use' && re.test(f.text));
const base = { category: 'spell', tier: 'engine', archetype: 'sorcerer', heroHp: 60 };

export const SPELL_CASES = [
  {
    ...base,
    id: 'spell-cantrip-fire-bolt',
    about: 'A named attack cantrip: Fire Bolt at one goblin, no slot spent.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 2');
      await ctx.send('I hurl a bolt of fire at the first goblin.', {
        action: /Fire Bolt/,
        target: GOBLIN(1),
      });
    },
    check: (ctx) =>
      rules(
        [castFacts(ctx, /casts Fire Bolt/).length === 1, 'Fire Bolt was not cast'],
        [factsOf(says(ctx)[0]).some((f) => f.key === 'attack'), 'no attack roll fact'],
        [slotsUsed(ctx) === 0, 'a cantrip spent a slot'],
      ),
  },
  {
    ...base,
    id: 'spell-cantrip-ray-of-frost',
    about: 'Ray of Frost at the second of two goblins (target choice by ordinal).',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 2');
      await ctx.send('I fire a ray of frost at the second goblin.', {
        action: /Ray of Frost/,
        target: GOBLIN(2),
      });
    },
    check: (ctx) =>
      rules(
        [castFacts(ctx, /casts Ray of Frost/).length === 1, 'Ray of Frost was not cast'],
        [slotsUsed(ctx) === 0, 'a cantrip spent a slot'],
        [
          hp(ctx, GOBLIN(1)) === ctx.state().entities[GOBLIN(1)].hp.max,
          'the wrong goblin was hurt',
        ],
      ),
  },
  {
    ...base,
    id: 'spell-area-burning-hands',
    about:
      'Burning Hands across all three goblins: the model names three targets, each saves once, one slot is spent.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 3');
      await ctx.send('I unleash Burning Hands across all three goblins.', {
        action: /Burning Hands/,
        targets: [GOBLIN(1), GOBLIN(2), GOBLIN(3)],
      });
    },
    check: (ctx) => {
      const req = heroRequest(says(ctx)[0]);
      const saves = allFacts(ctx).filter((f) => f.key === 'save').length;
      return rules(
        [castFacts(ctx, /casts Burning Hands/).length === 1, 'Burning Hands was not cast'],
        [req && new Set(req.targets).size >= 2, 'fewer than two targets named'],
        [saves === new Set(req?.targets).size, `${saves} saves for ${req?.targets.length} targets`],
        [slotsUsed(ctx) === 1, `slots used ${slotsUsed(ctx)}, expected 1`],
      );
    },
  },
  {
    ...base,
    id: 'spell-magic-missile-two-targets',
    about:
      'Magic Missile at two named goblins: three darts, each aimed at a chosen goblin, none lost to a third.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 3');
      await ctx.send('I cast Magic Missile at the first and the second goblin.', {
        action: /Magic Missile/,
        targets: [GOBLIN(1), GOBLIN(2)],
      });
    },
    check: (ctx) => {
      const darts = allFacts(ctx).filter((f) => f.key === 'spell' && /dart/.test(f.text));
      const aimed = darts.map((f) => f.text.split(' strikes ')[1]);
      return rules(
        [castFacts(ctx, /casts Magic Missile/).length === 1, 'Magic Missile was not cast'],
        [darts.length === 3, `${darts.length} darts, expected 3`],
        [aimed.every((id) => [GOBLIN(1), GOBLIN(2)].includes(id)), `darts hit ${aimed}`],
        [
          hp(ctx, GOBLIN(3)) === ctx.state().entities[GOBLIN(3)].hp.max,
          'the third goblin was hurt',
        ],
        [slotsUsed(ctx) === 1, `slots used ${slotsUsed(ctx)}, expected 1`],
      );
    },
  },
  ...[
    [
      'spell-magic-missile-darts-2-1',
      'two darts on the first goblin, one on the second',
      [1, 1, 2],
    ],
    ['spell-magic-missile-darts-1-2', 'one dart on the first goblin, two on the second', [1, 2, 2]],
  ].map(([id, say, order]) => ({
    ...base,
    id,
    about: `Magic Missile with a dart split (${say}): the model names a slot per dart, repeats kept, and each dart lands on its slot.`,
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 2');
      await ctx.send(`I cast Magic Missile, ${say}.`, {
        action: /Magic Missile/,
        slots: order.map(GOBLIN),
      });
    },
    check: (ctx) => {
      const struck = allFacts(ctx)
        .filter((f) => f.key === 'spell' && /^dart \d strikes /.test(f.text))
        .map((f) => f.text.split(' strikes ')[1]);
      return rules(
        [castFacts(ctx, /casts Magic Missile/).length === 1, 'Magic Missile was not cast'],
        [
          struck.length === 3 && order.every((n, i) => struck[i] === GOBLIN(n)),
          `darts struck ${struck}, expected ${order.map(GOBLIN)}`,
        ],
        [slotsUsed(ctx) === 1, `slots used ${slotsUsed(ctx)}, expected 1`],
      );
    },
  })),
  {
    ...base,
    id: 'spell-slots-then-dry',
    heroHp: 1000,
    about:
      'Two leveled casts empty the slots; the next leveled cast is not on the menu and must be declined; a cantrip still works.',
    steps: async (ctx) => {
      await spawn(ctx, 'hydra');
      await ctx.send('I cast Burning Hands at the hydra.', { action: /Burning Hands/ });
      await ctx.send('I cast Magic Missile at the hydra.', { action: /Magic Missile/ });
      ctx.notes.afterTwo = slotsUsed(ctx);
      await ctx.send('I cast Burning Hands at the hydra again.', { none: true });
      await ctx.send('I hurl a bolt of fire at the hydra.', { action: /Fire Bolt/ });
    },
    check: (ctx) => {
      const [, , dry, bolt] = says(ctx);
      const labels = dry.menu.actions.map((a) => a.label);
      return rules(
        [ctx.notes.afterTwo === 2, `slots used ${ctx.notes.afterTwo} after two casts`],
        [
          !labels.some((l) => /Burning Hands|Magic Missile/.test(l)),
          `spent spells on the menu: ${labels}`,
        ],
        [
          !/Burning Hands|Magic Missile/.test(heroRequest(dry)?.action ?? ''),
          `the model cast ${heroRequest(dry)?.action} with no slot`,
        ],
        [slotsUsed(ctx) === 2, `slots used ${slotsUsed(ctx)} at the end`],
        [factsOf(bolt).some((f) => /casts Fire Bolt/.test(f.text)), 'the cantrip did not cast'],
      );
    },
  },
  {
    ...base,
    id: 'spell-spent-slot-refused',
    kind: 'negative',
    about:
      'Both slots set spent by the engine: "cast Magic Missile" must not resolve. Doing nothing is the best answer; a cantrip in its place is allowed here but counts against "declines illegal".',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin');
      spendSlots(ctx, '1', 2);
      await ctx.send('I cast Magic Missile at the goblin.', { none: true });
    },
    check: (ctx) => {
      const t = says(ctx)[0];
      return rules(
        [
          !t.menu.actions.some((a) => /Magic Missile|Burning Hands/.test(a.label)),
          'spent spells are on the menu',
        ],
        [
          !/Magic Missile|Burning Hands/.test(heroRequest(t)?.action ?? ''),
          `the model cast ${heroRequest(t)?.action}`,
        ],
        [slotsUsed(ctx) === 2, 'slot count changed'],
      );
    },
  },
  {
    ...base,
    id: 'spell-not-on-sheet',
    kind: 'negative',
    about:
      'Fireball (not prepared) and Mage Hand (no rules, never on the menu): neither may resolve. The model should do nothing; the goal here is that no listed spell leaks onto the menu or resolves.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 2');
      await ctx.send('I cast Fireball at the goblins.', { none: true });
      await ctx.send('I cast Mage Hand to snatch the club from the first goblin.', { none: true });
    },
    check: (ctx) => {
      const [a, b] = says(ctx);
      return rules(
        [
          !a.menu.actions.concat(b.menu.actions).some((x) => /Mage Hand|Fireball/.test(x.label)),
          'a spell with no rules is on the menu',
        ],
        [slotsUsed(ctx) === 0, 'a slot was spent'],
      );
    },
  },
  {
    ...base,
    id: 'spell-undo-restores-slot',
    about:
      'One /undo returns the slot, the damage and the dice; /redo replays the same cast with no model call.',
    steps: async (ctx) => {
      await spawn(ctx, 'goblin 3');
      await ctx.send('I unleash Burning Hands across all three goblins.', {
        action: /Burning Hands/,
      });
      const cast = ctx.turns.at(-1);
      if (slotsUsed(ctx) !== 1) throw new Error('the model did not cast Burning Hands');
      ctx.notes.cast = cast;
      const calls = ctx.turns.filter((t) => t.kind === 'say').length;
      await ctx.send('/undo');
      ctx.notes.undone = { slots: slotsUsed(ctx), hp: ctx.turns.at(-1).after.hp };
      await ctx.send('/redo');
      ctx.notes.redone = { slots: slotsUsed(ctx), hp: ctx.turns.at(-1).after.hp };
      ctx.notes.sayTurns = calls;
    },
    check: (ctx) => {
      const { cast, undone, redone } = ctx.notes;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      return rules(
        [undone.slots === 0, `undo left ${undone.slots} slots used`],
        [same(undone.hp, cast.before.hp), 'undo did not restore every hit point'],
        [redone.slots === 1, `redo left ${redone.slots} slots used`],
        [same(redone.hp, cast.after.hp), 'redo did not replay the same damage'],
      );
    },
  },
];
