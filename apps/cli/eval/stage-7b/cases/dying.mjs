/**
 * 7B.1 dying and death saves. The hero is put at 0 HP by an engine setup commit (the same
 * events a real drop writes), so the cases do not depend on the dice dropping the hero;
 * `dying-real-downing` is the one that lets a real monster do it.
 * What the model must do here is almost nothing: the engine skips intent and decision on a
 * dying turn, so the live questions are "does the model call stay out of it" (audited on
 * every turn) and "does the narration stay truthful" (probes).
 */
import {
  HERO,
  allFacts,
  cmdOut,
  deathSaves,
  encounter,
  factsOf,
  hp,
  isDead,
  isDying,
  pinOrder,
  downHero,
  rules,
  says,
  setHp,
  spawn,
} from '../lib/driver.mjs';

const FLAVOR = [
  'I cling to a memory of home.',
  'I hold on.',
  'I whisper a prayer.',
  'I reach for the light.',
  'I will not let go.',
  'I think of the road behind me.',
  'I breathe.',
  'I wait.',
];

/** Dying turns until the hero is no longer dying (dead, stable and recovered, or awake). */
async function dieOut(ctx, max = 8) {
  for (let i = 0; i < max && isDying(ctx); i += 1) await ctx.send(FLAVOR[i % FLAVOR.length]);
}

const keys = (ctx) => allFacts(ctx).map((f) => f.key);

async function wolfScene(ctx) {
  await spawn(ctx, 'wolf');
  pinOrder(ctx, [HERO, 'wolf_1']);
}

export const DYING_CASES = [
  {
    id: 'dying-save-sequence',
    category: 'dying',
    tier: 'engine',
    about:
      'Hero at 0 HP: every input is a death save, one model call (narration), hostiles hold, and the spell ends dead, stable-and-recovered, or awake on a natural 20.',
    steps: async (ctx) => {
      await wolfScene(ctx);
      downHero(ctx);
      await dieOut(ctx);
    },
    check: (ctx) => {
      const turns = says(ctx);
      const last = deathSaves(ctx);
      const ends = isDead(ctx) ? 'dead' : hp(ctx, HERO) > 0 ? 'awake' : 'still dying';
      return rules(
        [turns.length >= 1, 'no dying turn ran'],
        [
          turns.every((t) => factsOf(t).some((f) => f.key === 'death_save')),
          'a turn had no death save',
        ],
        [!keys(ctx).includes('npc_attack'), 'the wolf attacked a dying hero'],
        [ends !== 'still dying', 'still dying after 8 turns'],
        [
          ends !== 'dead' ||
            last.failures >= 3 ||
            allFacts(ctx).some((f) => /natural 1/i.test(f.text)),
          'dead with fewer than 3 failures',
        ],
        [ends !== 'awake' || hp(ctx, HERO) === 1, `woke with ${hp(ctx, HERO)} HP, expected 1`],
        [
          ends !== 'awake' || !keys(ctx).includes('recovery') || encounter(ctx) === null,
          'solo hero recovered but the encounter stays open',
        ],
        [ends !== 'awake' || deathSaves(ctx) === null, 'awake hero kept a death-save tally'],
      );
    },
  },
  {
    id: 'dying-text-is-flavor',
    category: 'dying',
    tier: 'engine',
    kind: 'negative',
    about:
      'While dying, "I attack the wolf!" is narration flavor: no attack fact, the wolf is untouched, the turn is a death save.',
    steps: async (ctx) => {
      await wolfScene(ctx);
      downHero(ctx);
      await ctx.send('I rise and stab the wolf with my dagger!');
    },
    check: (ctx) => {
      const t = says(ctx)[0];
      return rules(
        [factsOf(t).some((f) => f.key === 'death_save'), 'the turn was not a death save'],
        [!factsOf(t).some((f) => f.key === 'attack'), 'the hero attacked while dying'],
        [t.calls === 1, `${t.calls} model calls on a dying turn`],
        [hp(ctx, 'wolf_1') === ctx.state().entities.wolf_1.hp.max, 'the wolf lost hit points'],
      );
    },
  },
  {
    id: 'dying-dead-is-terminal',
    category: 'dying',
    tier: 'engine',
    about:
      'After the third failure the hero is dead: /status says so, and further input changes nothing and calls no model. (Exhaustion 5 makes the saves almost sure failures: d20 - 10.)',
    steps: async (ctx) => {
      await wolfScene(ctx);
      downHero(ctx, { successes: 0, failures: 0, stable: false, dead: false }, 5);
      await dieOut(ctx);
      if (!isDead(ctx)) ctx.inconclusive('the dice did not kill the hero');
      await ctx.send('/status');
      const frozen = ctx.engine.commits.length;
      ctx.notes.frozen = frozen;
      await ctx.send('I get up and stab the wolf.');
      await ctx.send('/status');
    },
    check: (ctx) => {
      const after = says(ctx).at(-1);
      return rules(
        [cmdOut(ctx, '/status').includes('Status: DEAD'), '/status does not say DEAD'],
        [after.result.status === 'none', `status ${after.result.status} after death`],
        [after.calls === 0, `${after.calls} model calls after death`],
        [ctx.engine.commits.length === ctx.notes.frozen, 'a commit landed after death'],
      );
    },
  },
  {
    id: 'dying-undo-redo',
    category: 'dying',
    tier: 'engine',
    about:
      'One /undo reverts a whole dying turn (tally and dice), /redo replays it with no model call.',
    steps: async (ctx) => {
      await wolfScene(ctx);
      downHero(ctx);
      await ctx.send(FLAVOR[0]);
      if (!isDying(ctx)) ctx.inconclusive('the first save already ended the spell');
      const first = ctx.turns.at(-1);
      await ctx.send(FLAVOR[1]);
      ctx.notes.second = ctx.turns.at(-1);
      ctx.notes.first = first;
      await ctx.send('/undo');
      ctx.notes.undone = {
        death: structuredClone(deathSaves(ctx)),
        rng: structuredClone(ctx.state().rng),
      };
      await ctx.send('/redo');
      ctx.notes.redone = { death: structuredClone(deathSaves(ctx)) };
    },
    check: (ctx) => {
      const { second, first, undone, redone } = ctx.notes;
      const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
      return rules(
        [same(undone.death, second.before.death), 'undo did not restore the death-save tally'],
        [same(undone.rng, second.before.rng), 'undo did not restore the RNG'],
        [same(second.before.death, first.after.death), 'tally moved between turns'],
        [same(redone.death, second.after.death), 'redo did not replay the same save'],
      );
    },
  },
  {
    id: 'dying-real-downing',
    category: 'dying',
    tier: 'engine',
    about:
      'A hero at 1 HP acts after three wolves: if a wolf drops them first, the declared attack is skipped, /status says DYING, and the wolves hold.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 3');
      setHp(ctx, HERO, 1);
      pinOrder(ctx, ['wolf_1', 'wolf_2', 'wolf_3', HERO]);
      const t = await ctx.send('I stab the wolf with my dagger.');
      if (hp(ctx, HERO) > 0) ctx.inconclusive('every wolf missed');
      // The wolves after the hero in the order can drop them too, but then the hero already acted.
      if (factsOf(t).some((f) => f.key === 'attack'))
        ctx.inconclusive('the hero acted before falling');
      ctx.notes.dropTurn = t;
      await ctx.send('/status');
      if (isDying(ctx)) await ctx.send('I fight to stay awake.');
    },
    check: (ctx) => {
      const drop = ctx.notes.dropTurn;
      const next = says(ctx)[1];
      const wolfHp = ['wolf_1', 'wolf_2', 'wolf_3'].map((id) => hp(ctx, id));
      return rules(
        [!factsOf(drop).some((f) => f.key === 'attack'), 'the hero attacked after being dropped'],
        [
          factsOf(drop).some((f) => f.key === 'condition' && /unconscious/.test(f.text)),
          'no unconscious fact',
        ],
        [wolfHp.every((v) => v === 11), `a wolf lost hit points: ${wolfHp}`],
        [
          /Status: (DYING|DEAD)/.test(cmdOut(ctx, '/status')),
          '/status shows neither DYING nor DEAD',
        ],
        [
          !next || factsOf(next).some((f) => f.key === 'death_save'),
          'the next turn was not a death save',
        ],
        [
          !next || !factsOf(next).some((f) => f.key === 'npc_attack'),
          'a wolf attacked the dying hero',
        ],
      );
    },
  },
];
