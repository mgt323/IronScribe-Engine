/**
 * 7A through the live model, tier "full": the model also reads prose into spawns, and the
 * engine's combat refusals and defaults are exercised by what a player would really type.
 */
import {
  HERO,
  allFacts,
  attitude,
  ofKind,
  others,
  pinOrder,
  rules,
  says,
  spawn,
  countKey,
  encounter,
} from '../lib/driver.mjs';

const lastClarify = (ctx) =>
  says(ctx)
    .filter((t) => t.result.status === 'clarify')
    .at(-1);

export const FULL_CASES = [
  {
    id: 'flow-ambush-opens-combat',
    category: 'flow',
    tier: 'full',
    heroHp: 80,
    about:
      'Prose spawns two hostile wolves; the first attack rolls initiative for 3 and opens combat.',
    steps: async (ctx) => {
      await ctx.send('Two wolves burst out of the brush, snarling at me.');
      await ctx.send('I stab the first wolf with my dagger.', {
        target: 'wolf_1',
        action: /dagger/i,
      });
    },
    check: (ctx) =>
      rules(
        [ofKind(ctx, 'wolf').length === 2, `wolves: ${ofKind(ctx, 'wolf').length}`],
        [ofKind(ctx, 'wolf').every((w) => attitude(w) === 'hostile'), 'wolves not hostile'],
        [countKey(ctx, 'initiative') === 3, `initiative lines ${countKey(ctx, 'initiative')}`],
        [encounter(ctx) !== null, 'no encounter after the first attack'],
      ),
  },
  {
    id: 'flow-spawn-alone-no-combat',
    category: 'flow',
    tier: 'full',
    about:
      'Spawning a hostile alone does not roll initiative; combat starts on the first targeted action.',
    steps: async (ctx) => {
      await ctx.send('A wolf growls at me from the treeline.');
    },
    check: (ctx) =>
      rules(
        [ofKind(ctx, 'wolf').length === 1, 'wolf not spawned'],
        [encounter(ctx) === null, 'encounter opened on spawn'],
        [countKey(ctx, 'initiative') === 0, 'rolled initiative on spawn'],
      ),
  },
  {
    id: 'flow-default-variant',
    category: 'flow',
    tier: 'full',
    about: '"A goblin" resolves to Goblin Warrior by policy, with no clarification question.',
    steps: async (ctx) => {
      await ctx.send('A goblin steps onto the road, sword drawn.');
    },
    check: (ctx) =>
      rules(
        [!lastClarify(ctx), 'asked a question for "goblin"'],
        [ofKind(ctx, 'goblin-warrior').length === 1, 'no Goblin Warrior in the scene'],
      ),
  },
  {
    id: 'flow-ambiguous-family-asks',
    category: 'flow',
    tier: 'full',
    kind: 'negative',
    about: 'A broad family ("a dragon") must clarify, not pick one silently.',
    steps: async (ctx) => {
      await ctx.send('A dragon lands in front of me.');
    },
    check: (ctx) =>
      rules(
        [
          others(ctx).length === 0,
          `spawned ${others(ctx)
            .map((e) => e.id)
            .join(',')} without asking`,
        ],
        [
          lastClarify(ctx)?.result.clarification?.reason === 'ambiguous_spawn',
          'no ambiguous_spawn question',
        ],
      ),
  },
  {
    id: 'flow-reinforcement-refused',
    category: 'flow',
    tier: 'full',
    heroHp: 80,
    about:
      'Mid-combat "another wolf arrives": engine refuses (combat_active), nothing is committed.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf');
      await ctx.send('I stab the wolf with my dagger.');
      ctx.notes.before = JSON.stringify(ctx.state());
      ctx.notes.undoable = ctx.session.orchestrator.canUndoTurn;
      await ctx.send('Another wolf leaps out of the trees and joins the fight.');
    },
    check: (ctx) => {
      const turn = lastClarify(ctx);
      return rules(
        [
          turn?.result.clarification?.reason === 'combat_active',
          `status ${says(ctx).at(-1).result.status}`,
        ],
        [ofKind(ctx, 'wolf').length === 1, 'a second wolf appeared mid-combat'],
        [JSON.stringify(ctx.state()) === ctx.notes.before, 'refused spawn changed state or RNG'],
        [
          ctx.session.orchestrator.canUndoTurn === ctx.notes.undoable,
          'refusal pushed undo history',
        ],
      );
    },
  },
  {
    id: 'flow-bystander-not-targeted',
    category: 'flow',
    tier: 'full',
    kind: 'negative',
    heroHp: 80,
    about: 'Friendly guard present; "attack the wolf" never lands on the guard.',
    steps: async (ctx) => {
      await spawn(ctx, 'guard 1 friendly');
      await spawn(ctx, 'wolf');
      await ctx.send('I stab the wolf with my dagger.', { target: 'wolf_1' });
      await ctx.send('I stab it again.', { target: 'wolf_1' });
    },
    check: (ctx) => {
      const guard = others(ctx).find((e) => e.id.startsWith('guard'));
      return rules(
        [!!guard, 'guard missing'],
        [
          !allFacts(ctx).some((f) => f.key === 'attack' && /guard/i.test(f.text)),
          'attack named the guard',
        ],
      );
    },
  },
  {
    id: 'flow-attack-the-fallen',
    category: 'flow',
    tier: 'full',
    kind: 'negative',
    heroHp: 80,
    about:
      'Attacking a creature that is already at 0 HP is not offered; the hero does not hit a corpse.',
    steps: async (ctx) => {
      await spawn(ctx, 'wolf 2');
      ctx.setup('wolf_1 down', [{ type: 'entity.damaged', entityId: 'wolf_1', amount: 99 }]);
      pinOrder(ctx, [HERO, 'wolf_2']);
      await ctx.send('I attack the first wolf again.');
      await ctx.send('I finish off the wolf that already fell.');
    },
    check: (ctx) =>
      rules(
        [ctx.state().entities.wolf_1.hp.current === 0, 'dead wolf was changed'],
        [
          says(ctx).every(
            (t) =>
              !t.result.commits.some(
                (c) =>
                  c.request?.targetAlias &&
                  t.menu.targets.find((m) => m.alias === c.request.targetAlias)?.entityId ===
                    'wolf_1',
              ),
          ),
          'hero targeted the dead wolf',
        ],
      ),
  },
];
