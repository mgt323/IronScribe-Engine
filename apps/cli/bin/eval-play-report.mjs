/** Summary and printing for eval-play.mjs. */

const pct = (n, d) => (d === 0 ? 0 : Math.round((n / d) * 1000) / 10);
const group = (rows) => ({
  runs: rows.length,
  pass: pct(rows.filter((r) => r.pass).length, rows.length),
});

function by(results, key) {
  const map = {};
  for (const r of results) (map[r[key]] ??= []).push(r);
  return map;
}

export function summarize(all) {
  const results = all.filter((r) => r.known === null);
  const byCase = by(all, 'id');
  const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] ?? 0;
  return {
    pass: group(results).pass,
    total: results.length,
    schemaErrors: results.filter((r) => r.schemaError).length,
    modelCalls: results.reduce((n, r) => n + r.modelCalls, 0),
    medianCaseMs: median(results.map((r) => r.ms)),
    categories: Object.fromEntries(
      Object.entries(by(results, 'category')).map(([k, v]) => [k, group(v)]),
    ),
    kinds: Object.fromEntries(Object.entries(by(results, 'kind')).map(([k, v]) => [k, group(v)])),
    cases: Object.fromEntries(Object.entries(byCase).map(([k, v]) => [k, group(v)])),
    knownGaps: [...new Set(all.filter((r) => r.known !== null).map((r) => r.id))],
    flaky: Object.entries(byCase)
      .filter(([, v]) => v.some((r) => r.pass) && v.some((r) => !r.pass))
      .map(([id]) => id),
  };
}

export function report(meta, results, options) {
  const s = summarize(results);
  if (options.json) {
    console.log(JSON.stringify({ ...meta, summary: s }, null, 2));
    return s;
  }
  console.log(`model: ${meta.model}\nurl: ${meta.url}\nruns: ${meta.runs}\n`);
  for (const [id, g] of Object.entries(s.cases)) {
    const rows = results.filter((r) => r.id === id);
    const known = rows[0].known;
    const mark = known ? 'KNOWN' : g.pass === 100 ? 'ok   ' : g.pass === 0 ? 'FAIL ' : 'FLAKY';
    console.log(`${mark} ${id.padEnd(30)} ${String(g.pass).padStart(5)}%  ${rows[0].kind}`);
    if (known && g.pass < 100) console.log(`        known gap: ${known}`);
    else if (g.pass < 100 || options.verbose) {
      for (const r of rows.filter((x) => !x.pass).slice(0, options.verbose ? rows.length : 1)) {
        console.log(`        ${r.reason}`);
        const last = r.turns.at(-1);
        if (last) console.log(`        last: ${JSON.stringify(last).slice(0, 220)}`);
      }
    }
  }
  console.log('\nBy category:');
  for (const [k, g] of Object.entries(s.categories))
    console.log(`  ${k.padEnd(10)} ${g.pass}%  (${g.runs} runs)`);
  console.log('By kind:');
  for (const [k, g] of Object.entries(s.kinds))
    console.log(`  ${k.padEnd(10)} ${g.pass}%  (${g.runs} runs)`);
  console.log(
    `\npass: ${s.pass}%   schema failures: ${s.schemaErrors}   flaky: ${s.flaky.join(', ') || 'none'}`,
  );
  console.log(`model calls: ${s.modelCalls}   median case: ${s.medianCaseMs} ms`);
  return s;
}
