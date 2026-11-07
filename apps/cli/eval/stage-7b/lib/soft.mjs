/**
 * Narration probes for 7B. Heuristics, scored as rates, never failing a case. The 7A
 * probes (grounding, outcome, hurt, attackers) still run; these add the 7B situations:
 *   dyingTruth  prose about a dying hero does not kill, save or wake them ahead of the facts
 *   noMechanics prose never mentions spell slots, levels, saves or DCs
 *   spellShown  a cast turn's prose shows the spell (its name or its visible effect)
 */
import { monsterNames, probeCase as probe7a } from '../../stage-7a/lib/soft.mjs';

export { monsterNames };

const DEATH =
  /\b(you (die|are dead|have died|perish)|life (leaves|fades from) you|you breathe your last)\b/i;
const WAKE =
  /\b(you (wake|awaken|come to|regain consciousness|stand|rise|get up)|eyes (flutter|open))\b/i;
const MECH =
  /\b(spell slots?|slots? left|level[- ]\d|saving throws?|death saves?|\bsave\b|DC ?\d|d\d+)\b/i;
const SPELL_WORDS = {
  'Fire Bolt': /fire|flame|bolt|ember|burn|scorch/i,
  'Ray of Frost': /frost|ice|cold|freez|rime|chill/i,
  'Burning Hands': /fire|flame|burn|scorch|fan|sheet/i,
  'Magic Missile': /missile|dart|bolt|force|glow|light|streak/i,
};

function probeTurn(turn) {
  const n = turn.result?.narration;
  if (turn.kind !== 'say' || !n) return null;
  const out = {};
  const f = turn.result.facts;
  const dying = f.some((x) => ['death_save', 'recovery', 'dead'].includes(x.key));
  if (dying) {
    const died = f.some((x) => x.key === 'dead');
    const woke = f.some((x) => x.key === 'recovery' || /natural 20|regains/i.test(x.text));
    out.dyingTruth =
      !died && DEATH.test(n)
        ? 'kills the hero ahead of the facts'
        : !woke && WAKE.test(n)
          ? 'wakes the hero ahead of the facts'
          : true;
  }
  out.noMechanics = MECH.test(n) ? `mentions "${n.match(MECH)[0]}"` : true;
  const cast = f.find((x) => x.key === 'use' && /casts /.test(x.text));
  if (cast) {
    const name = cast.text.replace(/^.* casts /, '');
    const re = SPELL_WORDS[name];
    out.spellShown = !re || re.test(n) ? true : `no sign of ${name}`;
  }
  return out;
}

export function probeCase(ctx, names) {
  const { tally, notes } = probe7a(ctx, names);
  ctx.turns.forEach((turn, i) => {
    for (const [k, v] of Object.entries(probeTurn(turn) ?? {})) {
      tally[k] ??= { ok: 0, total: 0 };
      tally[k].total += 1;
      if (v === true) tally[k].ok += 1;
      else notes.push(`turn ${i + 1} ${k}: ${v}`);
    }
  });
  return { tally, notes };
}
