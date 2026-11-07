/**
 * 7B summary and printing. A run is `pass` (goal and invariants), `fail`, or `skip` (the dice
 * did not make the situation; excluded from every rate). Three layers, reported apart:
 * engine invariants, case goals, and model behavior (spell / target accuracy, refusals,
 * narration probes, latency).
 */
import { summarize } from '../../stage-7a/lib/report.mjs';

const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const fmt = (x) => (x === null || x === undefined ? 'n/a' : `${x}%`);

export function summarize7b(everything) {
  // A case with `known:` is a documented gap: shown, but out of every rate.
  const all = everything.filter((r) => !r.known);
  const base = summarize(all);
  const rows = all.filter((r) => r.status !== 'skip');
  const intents = rows.flatMap((r) => r.intents);
  const rate = (field) => {
    const xs = intents.filter((i) => i.field === field);
    const ok = xs.filter((i) => i.ok).length;
    return { ok, total: xs.length, pct: pct(ok, xs.length) };
  };
  return {
    ...base,
    intent: {
      action: rate('action'),
      target: rate('target'),
      targets: rate('targets'),
      refusal: rate('refusal'),
    },
  };
}

function printKnown(all) {
  const seen = new Set();
  for (const r of all.filter((x) => x.known)) {
    if (seen.has(r.id)) continue;
    seen.add(r.id);
    const rows = all.filter((x) => x.id === r.id);
    const state = rows.some((x) => x.status === 'fail')
      ? 'STILL FAILING'
      : rows.every((x) => x.status === 'skip')
        ? 'not reproduced (dice)'
        : 'now passes: remove `known`';
    console.log(`KNOWN ${r.id.padEnd(36)} ${state}\n        ${r.known}`);
    if (rows.some((x) => x.goal !== true))
      console.log(`        GOAL:   ${rows.find((x) => x.goal !== true).goal}`);
  }
}

function printCases(all, s, verbose) {
  for (const [id, g] of Object.entries(s.cases)) {
    const rows = all.filter((r) => r.id === id);
    const mark = g.pass === 100 ? 'ok   ' : g.pass === 0 ? 'FAIL ' : 'FLAKY';
    const skips = rows.filter((r) => r.status === 'skip').length;
    console.log(
      `${mark} ${id.padEnd(36)} ${String(g.pass).padStart(5)}%  ${rows[0].tier}${skips ? `  (${skips} skipped)` : ''}`,
    );
    const failing = rows.filter((r) => r.status === 'fail');
    for (const r of failing.slice(0, verbose ? failing.length : 1)) {
      if (r.invariants.length)
        console.log(`        ENGINE: ${r.invariants.slice(0, verbose ? 20 : 2).join(' | ')}`);
      if (r.goal !== true) console.log(`        GOAL:   ${r.goal}`);
    }
    if (verbose)
      for (const r of rows.filter((x) => x.status === 'skip'))
        console.log(`        skipped: ${r.skipReason}`);
  }
}

function printSummary(s) {
  const line = (k, g) => `  ${k.padEnd(10)} ${fmt(g.pass)}  (${g.runs} runs)`;
  console.log('\nBy category:');
  for (const [k, g] of Object.entries(s.categories)) console.log(line(k, g));
  console.log('By tier:');
  for (const [k, g] of Object.entries(s.tiers)) console.log(line(k, g));
  const i = s.intent;
  const acc = (label, g) => `  ${label.padEnd(18)} ${fmt(g.pct)}  (${g.ok}/${g.total})`;
  console.log('\nModel behavior (goal-level):');
  console.log(acc('action / spell', i.action));
  console.log(acc('target', i.target));
  console.log(acc('several targets', i.targets));
  console.log(acc('declines illegal', i.refusal));
  console.log(`  schema failures    ${s.schemaErrors}`);
  console.log('Narration probes (soft, not in pass rate):');
  for (const [k, v] of Object.entries(s.narration))
    console.log(`  ${k.padEnd(16)} ${fmt(v.pct)}  (${v.ok}/${v.total})`);
  const l = s.latency;
  console.log(
    `\nLatency: p50 ${l.p50} ms, p95 ${l.p95} ms per turn; per turn ${l.callsPerTurn} model calls, ${l.repairsPerTurn} repairs, ${l.tokensPerTurn} tokens`,
  );
  console.log(
    `Engine invariants: ${s.invariantViolations} violations in ${s.casesWithViolations} runs`,
  );
  console.log(`Skipped (inconclusive dice): ${s.skipped}   flaky: ${s.flaky.join(', ') || 'none'}`);
  console.log(`\nPASS ${fmt(s.pass)}   goal-only ${fmt(s.goalPass)}   (${s.runs} runs)`);
}

export function report(meta, all, options) {
  const s = summarize7b(all);
  if (options.json) console.log(JSON.stringify({ ...meta, summary: s }, null, 2));
  else {
    console.log(
      `model: ${meta.model}\nurl: ${meta.url}\nruns: ${meta.runs}   seed: ${meta.seed}\n`,
    );
    printCases(all, s, options.verbose);
    printKnown(all);
    printSummary(s);
  }
  return s;
}
