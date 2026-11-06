/** Assertion helpers shared by eval-play cases. A check returns true or a failure message. */

export const HERO = 'hero';

/** `goblin_warrior_2` -> `goblin-warrior` */
export const baseId = (id) => id.replace(/_\d+$/, '').replace(/_/g, '-');

export const engineOf = (ctx) => ctx.session.orchestrator.engine;
export const stateOf = (ctx) => engineOf(ctx).state;

/** Present creatures other than the hero. */
export const others = (ctx) =>
  Object.values(stateOf(ctx).entities).filter((e) => e.id !== HERO && e.present);

export const monsters = (ctx, id) => others(ctx).filter((e) => baseId(e.id) === id);

export const cmds = (ctx) => ctx.turns.filter((t) => t.kind === 'cmd');
export const out = (ctx, input) => cmds(ctx).find((t) => t.input.startsWith(input))?.output ?? '';
export const says = (ctx) => ctx.turns.filter((t) => t.kind === 'say');
export const commits = (ctx) => says(ctx).flatMap((t) => t.result.commits);
export const facts = (ctx) => says(ctx).flatMap((t) => t.result.facts);
export const keys = (ctx) => facts(ctx).map((f) => f.key);
export const count = (ctx, key) => keys(ctx).filter((k) => k === key).length;

/** Requests the player's actions made (alias of the menu entry used). */
export const requests = (ctx) => commits(ctx).flatMap((c) => (c.request ? [c.request] : []));

/** Skill and ability of every check procedure that ran. */
export const checks = (ctx) =>
  commits(ctx).flatMap((c) => (c.procedure?.kind === 'check' ? [c.procedure] : []));

export const clarified = (ctx) => says(ctx).filter((t) => t.result.status === 'clarify');

/** First failing rule wins. Each rule is [condition, message]. */
export function rules(...pairs) {
  for (const [ok, message] of pairs) if (!ok) return message;
  return true;
}

export const NARRATION_LEAKS = /goblin_warrior_\d|[a-z]+_\d+\b|\bDC\b|\bAC\b|hit points|\bd20\b/i;
export const SECOND_PERSON = /\byou(r|rs|rself)?\b/i;
export const REASONING_LEAK = /<think>|<\/think>|<\|channel\|>/i;

/**
 * Every player attack in order: which creature it aimed at and with what.
 * Aliases are per turn, so each is resolved against the menu the model saw.
 */
export const aimed = (ctx) =>
  ctx.turns.flatMap((turn, index) =>
    turn.kind !== 'say'
      ? []
      : turn.result.commits.flatMap((c) => {
          if (!c.request?.targetAlias) return [];
          const target = turn.menu.targets.find((t) => t.alias === c.request.targetAlias);
          return [
            { turn: index, entityId: target?.entityId ?? null, actionAlias: c.request.actionAlias },
          ];
        }),
  );
