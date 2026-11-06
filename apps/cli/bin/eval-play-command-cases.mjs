/**
 * Slash-command cases for eval-play.mjs. Commands do not need the model to
 * choose anything, but /spawn, /act and /init still narrate through it.
 */
import { monsters, out, rules, stateOf } from './eval-play-helpers.mjs';

export const COMMAND_CASES = [
  {
    id: 'cmd-help',
    category: 'command',
    steps: ['/help'],
    check: (ctx) =>
      rules(
        ...['/status', '/act', '/spawn', '/init', '/undo', '/redo', '/log', '/save'].map((c) => [
          out(ctx, '/help').includes(c),
          `/help misses ${c}`,
        ]),
      ),
  },
  {
    id: 'cmd-spawn-count-attitude',
    category: 'command',
    steps: ['/spawn wolf 3 neutral'],
    check: (ctx) =>
      rules(
        [monsters(ctx, 'wolf').length === 3, 'expected 3 wolves'],
        [monsters(ctx, 'wolf').every((e) => e.system.attitude === 'neutral'), 'expected neutral'],
      ),
  },
  {
    id: 'cmd-spawn-plural',
    category: 'command',
    steps: ['/spawn skeletons 2'],
    check: (ctx) => rules([monsters(ctx, 'skeleton').length === 2, 'plural was not singularized']),
  },
  {
    id: 'cmd-spawn-ambiguous',
    kind: 'negative',
    category: 'command',
    steps: ['/spawn goblin'],
    check: (ctx) =>
      rules(
        [/Which one/.test(out(ctx, '/spawn')), 'no question'],
        [stateOf(ctx).spawnOrder.length === 1, 'spawned while ambiguous'],
      ),
  },
  {
    id: 'cmd-spawn-unknown',
    kind: 'negative',
    category: 'command',
    steps: ['/spawn unicornz'],
    check: (ctx) => rules([/No catalog match/.test(out(ctx, '/spawn')), 'no error message']),
  },
  {
    id: 'cmd-spawn-usage',
    kind: 'negative',
    category: 'command',
    steps: ['/spawn'],
    check: (ctx) => rules([/Usage/.test(out(ctx, '/spawn')), 'no usage message']),
  },
  {
    id: 'cmd-act-attack',
    category: 'command',
    steps: ['/spawn goblin-warrior', '/act A1 T1'],
    check: (ctx) =>
      rules(
        [/vs AC/.test(out(ctx, '/act')), 'no attack line'],
        [
          /Initiative|initiative|Goblin Warrior \d+/.test(out(ctx, '/act')),
          'no initiative before the attack',
        ],
      ),
  },
  {
    id: 'cmd-act-illegal',
    kind: 'negative',
    category: 'command',
    steps: ['/spawn wolf', '/act A9 T1', '/act A1 T9', '/act banana'],
    check: (ctx) =>
      rules([
        stateOf(ctx).entities.wolf_1.hp.current === stateOf(ctx).entities.wolf_1.hp.max,
        'state changed',
      ]),
  },
  {
    id: 'cmd-init',
    category: 'command',
    steps: ['/spawn goblin-warrior', '/init'],
    check: (ctx) =>
      rules([stateOf(ctx).system.encounter?.order?.length === 2, 'no initiative order']),
  },
  {
    id: 'cmd-undo-redo',
    category: 'command',
    steps: ['/spawn wolf', '/undo', '/redo'],
    check: (ctx) => rules([monsters(ctx, 'wolf').length === 1, 'redo did not restore the wolf']),
  },
  {
    id: 'cmd-undo-removes-spawn',
    category: 'command',
    steps: ['/spawn wolf', '/undo'],
    check: (ctx) =>
      rules(
        [monsters(ctx, 'wolf').length === 0, 'wolf still there'],
        [stateOf(ctx).entities.hero !== undefined, 'hero removed'],
      ),
  },
  {
    id: 'cmd-undo-empty',
    kind: 'negative',
    category: 'command',
    steps: ['/undo', '/redo'],
    check: (ctx) =>
      rules(
        [/Nothing to undo/.test(out(ctx, '/undo')), 'no undo message'],
        [/Nothing to redo/.test(out(ctx, '/redo')), 'no redo message'],
      ),
  },
  {
    id: 'cmd-status-menu',
    category: 'command',
    steps: ['/spawn wolf', '/status'],
    check: (ctx) =>
      rules(
        [/A1 Dagger/.test(out(ctx, '/status')), 'no A1'],
        [/T1 Wolf/.test(out(ctx, '/status')), 'no T1'],
      ),
  },
  {
    id: 'cmd-sheet-and-unknown',
    kind: 'negative',
    category: 'command',
    steps: ['/sheet', '/dance'],
    check: (ctx) =>
      rules(
        [/Rogue/.test(out(ctx, '/sheet')), 'no sheet'],
        [/Unknown command/.test(out(ctx, '/dance')), 'no unknown-command message'],
      ),
  },
];
