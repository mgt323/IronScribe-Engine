/**
 * One end-to-end session: friendly, neutral and hostile encounters, a target
 * shift, a target going down, and an attack on the fallen target (negative).
 * The scene shift to a new fight is a 7B gap: spawns are refused during combat. Mixes model turns with one engine setup step.
 */
import { aimed, count, monsters, others, rules, stateOf } from './eval-play-helpers.mjs';

const hp = (ctx, id) => stateOf(ctx).entities[id]?.hp.current;
const attitude = (ctx, id) => others(ctx).find((e) => e.id.startsWith(id))?.system.attitude;

/** Leave wolf_1 at 1 HP, then stab it until it drops. A miss just means another try. */
async function bringWolfDown(ctx) {
  const engine = ctx.session.orchestrator.engine;
  const wolf = stateOf(ctx).entities.wolf_1;
  if (!wolf) return;
  if (wolf.hp.current > 1) {
    engine.commit('setup: wound wolf_1', [
      { type: 'entity.damaged', entityId: 'wolf_1', amount: wolf.hp.current - 1 },
    ]);
  }
  for (let tries = 0; tries < 8 && hp(ctx, 'wolf_1') > 0; tries += 1) {
    await ctx.send('I stab the first wolf with my dagger.');
  }
  ctx.downAt = ctx.turns.length;
}

export const E2E_CASES = [
  {
    id: 'e2e-three-encounters',
    category: 'e2e',
    steps: [
      'A friendly guard approaches me at the village gate and smiles.',
      'A cultist sits by the road, paying me no attention at all.',
      'Two wolves burst out of the brush, snarling at me.',
      'I stab the first wolf with my dagger.',
      'Now I shoot the other wolf with my shortbow.',
      bringWolfDown,
      'I attack the first wolf again.',
    ],
    check: (ctx) => {
      const shots = aimed(ctx);
      const afterDown = shots.filter((s) => s.turn >= (ctx.downAt ?? Infinity));
      const forbidden = ['guard_1', 'cultist_1'];
      return rules(
        // Encounters of three kinds, each exactly once.
        [monsters(ctx, 'guard').length === 1, 'expected one guard'],
        [attitude(ctx, 'guard') === 'friendly', `guard is ${attitude(ctx, 'guard')}`],
        [monsters(ctx, 'cultist').length === 1, 'expected one cultist'],
        [attitude(ctx, 'cultist') !== 'hostile', 'cultist should not be hostile'],
        [
          monsters(ctx, 'wolf').length === 2,
          `expected 2 wolves, got ${monsters(ctx, 'wolf').length}`,
        ],
        [monsters(ctx, 'wolf').every((w) => w.system.attitude === 'hostile'), 'wolves not hostile'],
        // Target shift: first the first wolf, then the other one, with the bow.
        [shots[0]?.entityId === 'wolf_1', `first attack hit ${shots[0]?.entityId}`],
        [shots[1]?.entityId === 'wolf_2', `second attack aimed at ${shots[1]?.entityId}`],
        [shots[1]?.actionAlias === 'A2', 'second attack should use the shortbow (A2)'],
        // Target down.
        [hp(ctx, 'wolf_1') === 0, 'wolf_1 did not go down'],
        // Negative: nothing attacks the fallen wolf again, and nothing revives it.
        [
          !afterDown.some((s) => s.entityId === 'wolf_1'),
          'attacked the wolf that was already down',
        ],
        [
          afterDown.every((s) => !forbidden.includes(s.entityId)),
          'attacked a friendly or neutral NPC',
        ],
        // Nobody attacked a bystander.
        [shots.every((s) => !forbidden.includes(s.entityId)), 'hero attacked a bystander'],
        // Initiative once, for everyone present at the first attack.
        [count(ctx, 'initiative') === 5, `initiative lines: ${count(ctx, 'initiative')}`],
      );
    },
  },
];
