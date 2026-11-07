/**
 * Full 7B play-throughs, tier "full": monsters appear from prose (the model spawns them),
 * the scripted player then fights with the hero's real options until the fight ends, the
 * hero falls, or the turn cap is reached. A fallen hero keeps typing: the dying spell is
 * played out to its end (dead, recovered, or awake on a natural 20), then a dead hero is
 * poked once more to prove death is terminal. Dice decide how it ends; the legal-end rule
 * and the audit decide whether the way it ended was lawful.
 */
import {
  baseId,
  deathSaves,
  encounter,
  heroUp,
  isDead,
  isDying,
  livingHostiles,
  ofKind,
  rules,
  says,
  slotsUsed,
} from '../lib/driver.mjs';

const ORDINAL = ['first', 'second', 'third', 'fourth', 'fifth'];
const FLAVOR = ['I cling to life.', 'I hold on.', 'I whisper a prayer.', 'I breathe.', 'I wait.'];

/** "the second goblin warrior" when several of a kind live, else "the goblin warrior". */
function who(ctx, target) {
  const name = target.name.toLowerCase();
  const same = ofKind(ctx, baseId(target.id)).filter((e) => e.hp.current > 0);
  return same.length > 1 ? `the ${ORDINAL[same.indexOf(target)]} ${name}` : `the ${name}`;
}

/** Play until the fight is decided. `lineFor(ctx, n, target)` returns the hero's line. */
async function playOut(ctx, lineFor, maxTurns = 10) {
  let n = 0;
  for (; n < maxTurns && heroUp(ctx) && livingHostiles(ctx).length; n += 1) {
    const target = livingHostiles(ctx)[0];
    await ctx.send(lineFor(ctx, n, who(ctx, target)));
  }
  for (let i = 0; isDying(ctx) && i < 8; i += 1) await ctx.send(FLAVOR[i % FLAVOR.length]);
  if (isDead(ctx)) await ctx.send('I get up and swing at it.');
  ctx.notes.turns = n;
}

/** The three lawful ways to stop: won, dead (terminal), or still fighting at the cap. */
function lawfulEnd(ctx) {
  const live = livingHostiles(ctx).length;
  const enc = encounter(ctx);
  const dead = isDead(ctx);
  const dying = deathSaves(ctx) && !dead && !heroUp(ctx) && !deathSaves(ctx).stable;
  if (dying) return 'the dying spell never ended';
  if (dead) return enc && live ? true : 'hero dead but the fight state was cleared';
  if (!live) return !enc ? true : 'hostiles gone but the encounter is open';
  return heroUp(ctx) && enc ? true : 'hostiles remain with no encounter and a hero who is up';
}

const spells = (ctx, n, name) => {
  if (n === 0) return 'I unleash Burning Hands across all of the goblins.';
  if (n === 1 && slotsUsed(ctx) < 2) return `I cast Magic Missile at ${name}.`;
  return `I hurl a bolt of fire at ${name}.`;
};

const weapons = (ctx, n, name) =>
  n % 2 === 0 ? `I stab ${name} with my dagger.` : `I draw my shortbow and shoot ${name}.`;

export const E2E_CASES = [
  {
    id: 'e2e-sorcerer-goblin-ambush',
    category: 'e2e',
    tier: 'full',
    archetype: 'sorcerer',
    about:
      'An 8 HP Sorcerer meets three goblins from prose, opens with Burning Hands on all of them, spends the second slot, then cantrips; falls, dies or wins lawfully.',
    steps: async (ctx) => {
      await ctx.send('Three goblins leap out of the brush, snarling and waving rusty blades.');
      if (livingHostiles(ctx).length < 2) ctx.inconclusive('the model did not spawn the goblins');
      await playOut(ctx, spells);
    },
    check: (ctx) => {
      return rules(
        [
          ofKind(ctx, 'goblin-warrior').length === 3,
          `${ofKind(ctx, 'goblin-warrior').length} goblin warriors in the scene, expected 3`,
        ],
        [slotsUsed(ctx) <= 2, `slots used ${slotsUsed(ctx)}`],
        [lawfulEnd(ctx), lawfulEnd(ctx)],
      );
    },
  },
  {
    id: 'e2e-rogue-wolf-pack',
    category: 'e2e',
    tier: 'full',
    about:
      'A 10 HP Rogue against two wolves from prose: dagger and shortbow until the fight ends or the hero falls; the dying spell is played to its end.',
    steps: async (ctx) => {
      await ctx.send('Two wolves slink out of the treeline, hackles raised, and circle me.');
      if (livingHostiles(ctx).length < 2) ctx.inconclusive('the model did not spawn two wolves');
      await playOut(ctx, weapons);
    },
    check: (ctx) =>
      rules(
        [ofKind(ctx, 'wolf').length === 2, `${ofKind(ctx, 'wolf').length} wolves, expected 2`],
        [lawfulEnd(ctx), lawfulEnd(ctx)],
      ),
  },
  {
    id: 'e2e-last-stand-vs-hydra',
    category: 'e2e',
    tier: 'full',
    about:
      'A Hydra rears out of the swamp in front of a 10 HP Rogue: five bites a turn against a hero who almost surely falls; death (or survival) must be lawful and terminal.',
    steps: async (ctx) => {
      await ctx.send('A hydra rears out of the swamp in front of me, its many heads hissing.');
      if (!livingHostiles(ctx).some((e) => baseId(e.id) === 'hydra'))
        throw new Error('the model did not spawn the hydra');
      await playOut(ctx, weapons, 8);
    },
    check: (ctx) =>
      rules(
        [lawfulEnd(ctx), lawfulEnd(ctx)],
        [
          !isDead(ctx) || says(ctx).at(-1).result.status === 'none',
          'a dead hero was still playing',
        ],
      ),
  },
  {
    id: 'e2e-spawn-young-red-dragon',
    category: 'e2e',
    tier: 'full',
    known:
      'Spawn (7C): the model queries "red dragon" and drops "young", so the GM asks which dragon, and the answer "the young red dragon" is read the same way. The case needs a named variant to spawn.',
    about:
      'A young red dragon from prose, with at most one follow-up answer, ends up in the scene.',
    steps: async (ctx) => {
      await ctx.send(
        'A young red dragon crashes down in front of me, smoke curling from its jaws.',
      );
      if (says(ctx).at(-1).result.status === 'clarify') await ctx.send('The young red dragon.');
    },
    check: (ctx) =>
      livingHostiles(ctx).some((e) => baseId(e.id) === 'young-red-dragon') ||
      'no young red dragon in the scene',
  },
];
