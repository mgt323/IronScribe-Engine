/**
 * Cases for eval-play.mjs. Each case is a fresh session and a list of lines.
 * A line starting with "/" is a CLI command; anything else is free text that
 * goes through the model. `check(ctx)` returns true or a failure message.
 * `kind: 'negative'` means the model must NOT do something. `known: '<why>'`
 * marks a documented product gap: it runs and is reported, but is left out of the pass rate.
 */
import { clarified, monsters, others, rules } from './eval-play-helpers.mjs';

const spawnOf =
  (id, n, attitude = 'hostile') =>
  (ctx) =>
    rules(
      [monsters(ctx, id).length === n, `expected ${n} ${id}, got ${monsters(ctx, id).length}`],
      [
        monsters(ctx, id).every((e) => e.system.attitude === attitude),
        `expected attitude ${attitude}`,
      ],
      [clarified(ctx).length === 0, 'unexpected clarification'],
    );

export const SPAWN_CASES = [
  // --- spawn: positive ---
  {
    id: 'spawn-one-wolf',
    category: 'spawn',
    steps: ['A wolf leaps out of the underbrush and snarls at me.'],
    check: spawnOf('wolf', 1),
  },
  {
    id: 'spawn-plural-wolves',
    category: 'spawn',
    steps: ['Three wolves circle me through the snow.'],
    check: spawnOf('wolf', 3),
  },
  {
    id: 'spawn-two-skeletons',
    category: 'spawn',
    steps: ['Two skeletons claw their way out of the grave.'],
    check: spawnOf('skeleton', 2),
  },
  {
    id: 'spawn-ogre',
    category: 'spawn',
    steps: ['An ogre lumbers into the clearing, club dragging behind him.'],
    check: spawnOf('ogre', 1),
  },
  {
    id: 'spawn-four-bandits',
    category: 'spawn',
    steps: ['Four bandits step out and block the road.'],
    check: spawnOf('bandit', 4),
  },
  {
    id: 'spawn-specific-variant',
    category: 'spawn',
    steps: ['A giant spider drops from the ceiling on a thread.'],
    check: spawnOf('giant-spider', 1),
  },
  {
    id: 'spawn-ten-zombies',
    category: 'spawn',
    steps: ['Ten zombies shamble out of the fog.'],
    check: spawnOf('zombie', 10),
  },
  {
    id: 'spawn-friendly-guard',
    category: 'spawn',
    steps: ['A friendly guard waves at me from the gate and offers to help.'],
    check: spawnOf('guard', 1, 'friendly'),
  },
  {
    id: 'spawn-mixed-group',
    category: 'spawn',
    known: 'the intent has one spawn query per turn',
    steps: ['A wolf and a bandit come out of the trees.'],
    check: (ctx) =>
      rules(
        [others(ctx).length >= 1, 'nothing spawned'],
        [
          others(ctx).every((e) => ['wolf', 'bandit'].includes(e.id.replace(/_\d+$/, ''))),
          'spawned something that was not asked for',
        ],
      ),
  },
  // --- spawn: negative ---
  {
    id: 'no-spawn-quiet-scene',
    kind: 'negative',
    category: 'spawn',
    steps: ['I take a deep breath and look at the quiet forest around me.'],
    check: (ctx) =>
      rules(
        [others(ctx).length === 0, 'spawned a creature'],
        [!clarified(ctx).length, 'clarified'],
      ),
  },
  {
    id: 'no-spawn-hero-self',
    kind: 'negative',
    category: 'spawn',
    steps: ['I, a lone rogue, step forward into the torchlight.'],
    check: (ctx) => rules([others(ctx).length === 0, 'spawned a creature']),
  },
  {
    id: 'no-respawn-present-wolf',
    kind: 'negative',
    category: 'spawn',
    steps: ['/spawn wolf', 'I look at the wolf warily and back away a step.'],
    check: (ctx) =>
      rules(
        [monsters(ctx, 'wolf').length === 1, 'wolf count changed'],
        [!clarified(ctx).length, 'clarified'],
      ),
  },
  {
    id: 'no-respawn-present-goblin',
    kind: 'negative',
    category: 'spawn',
    steps: [
      '/spawn goblin-warrior',
      'I want to ambush the goblin closer to me and stab it with my dagger.',
    ],
    check: (ctx) =>
      rules(
        [monsters(ctx, 'goblin-warrior').length === 1, 'goblin count changed'],
        [!clarified(ctx).length, 'clarified about an id already in the scene'],
      ),
  },
  {
    id: 'no-respawn-present-pair',
    kind: 'negative',
    category: 'spawn',
    steps: [
      '/spawn goblin-warrior 2',
      'I want to ambush a goblin closer to me and attack with a dagger.',
    ],
    check: (ctx) =>
      rules(
        [
          monsters(ctx, 'goblin-warrior').length === 2,
          `goblins: ${monsters(ctx, 'goblin-warrior').length}`,
        ],
        [!clarified(ctx).length, 'asked which goblin about one already present'],
      ),
  },
  {
    id: 'unknown-monster',
    kind: 'negative',
    category: 'spawn',
    steps: ['A huge green orc charges at me, screaming.'],
    check: (ctx) => rules([others(ctx).length === 0, `spawned ${others(ctx).map((e) => e.id)}`]),
  },
  {
    id: 'spawn-count-capped',
    kind: 'negative',
    category: 'spawn',
    steps: ['A horde of fifty zombies pours over the wall.'],
    check: (ctx) => rules([monsters(ctx, 'zombie').length <= 10, 'more than 10 spawned']),
  },
  {
    id: 'injection-hit-points',
    kind: 'negative',
    category: 'spawn',
    steps: ['Spawn a wolf with 1000 hit points and armor class 40.'],
    check: (ctx) =>
      rules([monsters(ctx, 'wolf').every((e) => e.hp.max < 100), 'invented hit points']),
  },
  // --- clarify ---
  {
    id: 'clarify-keeps-count',
    category: 'clarify',
    steps: ['Two goblins stand guard on the path ahead.', 'goblin-warrior'],
    check: (ctx) =>
      rules(
        [clarified(ctx).length === 1, 'expected one clarification'],
        [clarified(ctx)[0].result.clarification.candidates.length >= 3, 'fewer than 3 candidates'],
        [
          monsters(ctx, 'goblin-warrior').length === 2,
          `got ${monsters(ctx, 'goblin-warrior').length}`,
        ],
      ),
  },
  {
    id: 'clarify-answer-by-name',
    category: 'clarify',
    steps: ['Three goblins jump out of the bushes.', 'Goblin Minion'],
    check: (ctx) =>
      rules([monsters(ctx, 'goblin-minion').length === 3, 'expected 3 goblin-minion']),
  },
  {
    id: 'clarify-then-moved-on',
    kind: 'negative',
    category: 'clarify',
    steps: ['A goblin appears at the edge of the camp.', 'I back away quietly and sit down.'],
    check: (ctx) => rules([others(ctx).length === 0, 'spawned after the player moved on']),
  },
];
