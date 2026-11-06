/**
 * Scripted player policy: reads the state, writes a free-text line, and says what a
 * correct reading of that line looks like. The model is measured against that.
 */
import { HERO, livingHostiles, ofKind, baseId, encounter } from './driver.mjs';

const WEAPONS = [
  { verb: (n) => `I stab the ${n} with my dagger.`, action: /dagger/i },
  { verb: (n) => `I draw my shortbow and shoot the ${n}.`, action: /shortbow/i },
];

const spoken = (e) => e.name.toLowerCase();
const heroUp = (ctx) => ctx.state().entities[HERO].hp.current > 0;

/** Attack the lowest-id living hostile of the first kind, alternating weapons. */
export function nextAttack(ctx, turnNo) {
  const target = livingHostiles(ctx)[0];
  if (!target) return null;
  // With several of one kind the line must say which. "the first" is ambiguous after one falls.
  const same = ofKind(ctx, baseId(target.id)).filter((e) => e.hp.current > 0);
  const name =
    same.length > 1 ? `${ordinal(same.indexOf(target))} ${spoken(target)}` : spoken(target);
  const weapon = WEAPONS[turnNo % WEAPONS.length];
  return { line: weapon.verb(name), expect: { target: target.id, action: weapon.action } };
}

const ordinal = (i) => ['first', 'second', 'third', 'fourth', 'fifth'][i] ?? `number ${i + 1}`;

/**
 * Fight until the encounter ends, the hero falls, or the turn cap is reached.
 * Returns { turns, end } where end is 'victory' | 'down' | 'cap'.
 */
export async function fight(ctx, { maxTurns = 12, stopWhen } = {}) {
  for (let n = 0; n < maxTurns; n += 1) {
    if (!heroUp(ctx)) return { turns: n, end: 'down' };
    const step = nextAttack(ctx, n);
    if (!step) return { turns: n, end: 'victory' };
    await ctx.send(step.line, step.expect);
    if (stopWhen?.(ctx)) return { turns: n + 1, end: 'stopped' };
    if (!encounter(ctx) && !livingHostiles(ctx).length) return { turns: n + 1, end: 'victory' };
  }
  return { turns: maxTurns, end: heroUp(ctx) && encounter(ctx) ? 'cap' : 'victory' };
}

/** After a fight, the end state must be one of the three legal ones. */
export function legalEnd(ctx, end) {
  const live = livingHostiles(ctx).length;
  const enc = encounter(ctx);
  if (end === 'victory')
    return !enc && live === 0 ? true : 'victory but encounter or hostile remains';
  if (end === 'down') return enc && live > 0 ? true : 'hero down but encounter not suspended';
  return enc ? true : 'turn cap reached with no encounter';
}
