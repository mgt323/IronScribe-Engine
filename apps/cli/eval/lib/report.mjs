/**
 * Summary and printing. A run is `pass` (goal and invariants), `fail`, or `skip`
 * (dice did not make the situation; excluded from every rate).
 */
import { readFileSync } from 'node:fs';

const pct = (n, d) => (d === 0 ? null : Math.round((n / d) * 1000) / 10);
const q = (xs, p) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0;
};
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const groupBy = (rows, key) => {
  const m = {};
  for (const r of rows) (m[r[key]] ??= []).push(r);
  return m;
};
const rate = (rows) => ({
  runs: rows.length,
  pass: pct(rows.filter((r) => r.status === 'pass').length, rows.length),
});

export function summarize(all) {
  const rows = all.filter((r) => r.status !== 'skip');
  const turns = rows.flatMap((r) => r.timing);
  const intents = rows.flatMap((r) => r.intents);
  const intentRate = (field) => {
    const xs = intents.filter((i) => i.field === field);
    return {
      ok: xs.filter((i) => i.ok).length,
      total: xs.length,
      pct: pct(xs.filter((i) => i.ok).length, xs.length),
    };
  };
  const probes = {};
  for (const r of rows)
    for (const [k, v] of Object.entries(r.probes)) {
      probes[k] ??= { ok: 0, total: 0 };
      probes[k].ok += v.ok;
      probes[k].total += v.total;
    }
  for (const v of Object.values(probes)) v.pct = pct(v.ok, v.total);
  return {
    pass: rate(rows).pass,
    runs: rows.length,
    skipped: all.length - rows.length,
    goalPass: pct(rows.filter((r) => r.goal === true).length, rows.length),
    invariantViolations: sum(rows.map((r) => r.invariants.length)),
    casesWithViolations: rows.filter((r) => r.invariants.length).length,
    schemaErrors: rows.filter((r) => r.schemaError).length,
    intent: { target: intentRate('target'), action: intentRate('action') },
    narration: probes,
    latency: {
      turns: turns.length,
      p50: q(
        turns.map((t) => t.ms),
        0.5,
      ),
      p95: q(
        turns.map((t) => t.ms),
        0.95,
      ),
      callsPerTurn: turns.length
        ? Math.round((sum(turns.map((t) => t.calls)) / turns.length) * 100) / 100
        : 0,
      tokensPerTurn: turns.length ? Math.round(sum(turns.map((t) => t.tokens)) / turns.length) : 0,
      repairsPerTurn: turns.length
        ? Math.round((sum(turns.map((t) => t.repairs)) / turns.length) * 100) / 100
        : 0,
    },
    categories: Object.fromEntries(
      Object.entries(groupBy(rows, 'category')).map(([k, v]) => [k, rate(v)]),
    ),
    tiers: Object.fromEntries(Object.entries(groupBy(rows, 'tier')).map(([k, v]) => [k, rate(v)])),
    cases: Object.fromEntries(Object.entries(groupBy(rows, 'id')).map(([k, v]) => [k, rate(v)])),
    flaky: Object.entries(groupBy(rows, 'id'))
      .filter(([, v]) => v.some((r) => r.status === 'pass') && v.some((r) => r.status === 'fail'))
      .map(([id]) => id),
  };
}

const fmt = (x) => (x === null ? 'n/a' : `${x}%`);

function printCases(all, s, options) {
  for (const [id, g] of Object.entries(s.cases)) {
    const rows = all.filter((r) => r.id === id);
    const mark = g.pass === 100 ? 'ok   ' : g.pass === 0 ? 'FAIL ' : 'FLAKY';
    const skips = rows.filter((r) => r.status === 'skip').length;
    console.log(
      `${mark} ${id.padEnd(34)} ${String(g.pass).padStart(5)}%  ${rows[0].tier}${skips ? `  (${skips} skipped)` : ''}`,
    );
    const failing = rows.filter((r) => r.status === 'fail');
    for (const r of failing.slice(0, options.verbose ? failing.length : 1)) {
      if (r.invariants.length)
        console.log(
          `        ENGINE: ${r.invariants.slice(0, options.verbose ? 20 : 2).join(' | ')}`,
        );
      if (r.goal !== true) console.log(`        GOAL:   ${r.goal}`);
    }
    if (options.verbose)
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
  console.log('\nModel behavior (goal-level):');
  console.log(
    `  target accuracy   ${fmt(s.intent.target.pct)}  (${s.intent.target.ok}/${s.intent.target.total})`,
  );
  console.log(
    `  weapon accuracy   ${fmt(s.intent.action.pct)}  (${s.intent.action.ok}/${s.intent.action.total})`,
  );
  console.log(`  schema failures   ${s.schemaErrors}`);
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

function printCompare(s, file) {
  const base = JSON.parse(readFileSync(file, 'utf8')).summary;
  const d = (a, b, unit = '') =>
    a == null || b == null
      ? 'n/a'
      : `${a}${unit} (${a - b >= 0 ? '+' : ''}${Math.round((a - b) * 10) / 10}${unit})`;
  console.log(`\nvs ${file} (${base.model ?? '?'}):`);
  console.log(`  pass            ${d(s.pass, base.pass, '%')}`);
  console.log(`  target acc.     ${d(s.intent.target.pct, base.intent.target.pct, '%')}`);
  console.log(`  weapon acc.     ${d(s.intent.action.pct, base.intent.action.pct, '%')}`);
  console.log(
    `  p50 / p95 ms    ${d(s.latency.p50, base.latency.p50)} / ${d(s.latency.p95, base.latency.p95)}`,
  );
  console.log(`  invariants      ${d(s.invariantViolations, base.invariantViolations)}`);
  for (const id of Object.keys(s.cases)) {
    const was = base.cases[id]?.pass;
    if (was != null && was !== s.cases[id].pass)
      console.log(`  ${id}: ${was}% -> ${s.cases[id].pass}%`);
  }
}

export function report(meta, all, options) {
  const s = summarize(all);
  if (options.json) console.log(JSON.stringify({ ...meta, summary: s }, null, 2));
  else {
    console.log(
      `model: ${meta.model}\nurl: ${meta.url}\nruns: ${meta.runs}   seed: ${meta.seed}\n`,
    );
    printCases(all, s, options);
    printSummary(s);
    if (options.compare) printCompare(s, options.compare);
  }
  return s;
}
