#!/usr/bin/env node
/**
 * Tiny dice roller for Stage 1.
 *
 *   pnpm roll -- 2d6+3
 *   pnpm roll -- d20 --adv -m 5 --seed 42
 *   pnpm roll -- 1d8+2 --crit
 */

import { createRng, resolveRollMode, roll, rollD20 } from '../dist/index.js';

function printHelp() {
  console.log(`Usage:
  pnpm roll -- <formula> [options]

Examples:
  pnpm roll -- 2d6+3
  pnpm roll -- 4d6kh3 --seed campaign
  pnpm roll -- 1d8+2 --crit
  pnpm roll -- d20 --adv -m 5 --seed 42

Options:
  --advantage, --adv       roll a d20 with advantage
  --disadvantage, --dis    roll a d20 with disadvantage
  --modifier, -m <n>       d20 modifier (default 0)
  --critical, --crit       double dice terms (damage crit)
  --seed <value>           number or string seed (default: random)
  --help, -h               show this help
`);
}

function parseArgs(argv) {
  const options = {
    formula: undefined,
    advantage: false,
    disadvantage: false,
    modifier: 0,
    critical: false,
    seed: undefined,
    help: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      options.help = true;
      continue;
    }
    if (arg === '--advantage' || arg === '--adv') {
      options.advantage = true;
      continue;
    }
    if (arg === '--disadvantage' || arg === '--dis') {
      options.disadvantage = true;
      continue;
    }
    if (arg === '--critical' || arg === '--crit') {
      options.critical = true;
      continue;
    }
    if (arg === '--modifier' || arg === '-m') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new Error(`${arg} requires a number`);
      }
      const value = Number(raw);
      if (!Number.isInteger(value)) {
        throw new Error(`modifier must be an integer, got ${JSON.stringify(raw)}`);
      }
      options.modifier = value;
      i += 1;
      continue;
    }
    if (arg === '--seed') {
      const raw = argv[i + 1];
      if (raw === undefined) {
        throw new Error('--seed requires a value');
      }
      options.seed = /^-?\d+$/.test(raw) ? Number(raw) : raw;
      i += 1;
      continue;
    }
    if (arg.startsWith('-')) {
      throw new Error(`Unknown option: ${arg}`);
    }
    if (options.formula !== undefined) {
      throw new Error(`Unexpected argument: ${arg}`);
    }
    options.formula = arg;
  }

  return options;
}

function isD20Check(formula) {
  return /^(?:1)?d20$/i.test(formula.trim());
}

function formatDiceBreakdown(result) {
  const parts = result.terms.map((term) => {
    if (term.kind === 'constant') {
      const signed = term.sign * term.value;
      return String(signed);
    }
    const faces = term.rolls.join(', ');
    const kept = term.kept.length === term.rolls.length ? '' : ` keep [${term.kept.join(', ')}]`;
    const signed = term.sign === -1 ? '-' : '';
    return `${signed}${String(term.count)}d${String(term.sides)}[${faces}]${kept}`;
  });
  return `${result.formula} → ${parts.join(' ')} = ${String(result.total)}`;
}

function main() {
  let options;
  try {
    const argv = process.argv.slice(2);
    // pnpm may forward a leading "--" when nesting scripts.
    if (argv[0] === '--') {
      argv.shift();
    }
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  if (options.help || options.formula === undefined) {
    printHelp();
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const seed = options.seed ?? Date.now();
  const rng = createRng(seed);
  const useD20 =
    options.advantage ||
    options.disadvantage ||
    (isD20Check(options.formula) && options.modifier !== 0);

  try {
    if (useD20) {
      if (!isD20Check(options.formula)) {
        throw new Error('Advantage/disadvantage/modifier require a d20 (or 1d20) formula');
      }
      if (options.critical) {
        throw new Error('--critical applies to damage formulas, not d20 checks');
      }
      const mode = resolveRollMode({
        advantage: options.advantage,
        disadvantage: options.disadvantage,
      });
      const result = rollD20(rng, { mode, modifier: options.modifier });
      const dice = result.rolls.join(', ');
      console.log(
        `d20 ${mode} [${dice}] + ${String(result.modifier)} = ${String(result.total)} (seed ${String(seed)})`,
      );
      return;
    }

    const result = roll(options.formula, rng, { critical: options.critical });
    console.log(`${formatDiceBreakdown(result)} (seed ${String(seed)})`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

main();
