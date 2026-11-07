/**
 * `--provider oracle` for 7B: a rule-based stand-in for the model. It reads the same
 * prompts a real model gets and answers with string rules, now including spells and
 * several targets. It proves the harness and the engine invariants with no server (a
 * failure here is not a model problem) and gives the live model a ceiling to match.
 */
const WORDS = [
  ['young red dragon', 'young red dragon', 'hostile'],
  ['wolf', 'wolf', 'hostile'],
  ['wolves', 'wolf', 'hostile'],
  ['goblin', 'goblin', 'hostile'],
  ['hydra', 'hydra', 'hostile'],
  ['bandit', 'bandit', 'hostile'],
  ['dragon', 'young red dragon', 'hostile'],
  ['guard', 'guard', 'friendly'],
];
const COUNTS = { two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
const DART_COUNTS = { one: 1, two: 2, three: 3, 1: 1, 2: 2, 3: 3 };
const ORDINALS = ['first', 'second', 'third', 'fourth'];
const SPELLS = [
  [/fire ?bolt|bolt of fire/, /fire bolt/i],
  [/ray of frost|frost/, /ray of frost/i],
  [/burning hands|sheet of flame|flames/, /burning hands/i],
  [/magic missile|missiles?\b/, /magic missile/i],
  [/crossbow/, /crossbow/i],
  [/shortbow|\bbow\b|arrow/, /shortbow/i],
  [/dagger|stab|slash/, /dagger/i],
];
const NONE = {
  kind: 'none',
  actionAlias: null,
  targetAlias: null,
  secondaryTargetAlias: null,
  tertiaryTargetAlias: null,
};

const present = (scene) =>
  scene
    .split('Present:\n')[1]
    ?.split('\n\n')[0]
    .split('\n')
    .map((l) => l.toLowerCase()) ?? [];

function findHits(line) {
  const found = [];
  for (const [word, query, attitude] of WORDS) {
    const re = new RegExp(`\\b${word}s?\\b`, 'g');
    for (const match of line.matchAll(re)) {
      found.push({
        start: match.index,
        end: match.index + match[0].length,
        query,
        attitude,
      });
    }
  }
  found.sort((a, b) => a.start - b.start || b.end - a.end);
  const taken = [];
  for (const hit of found) {
    if (taken.some((kept) => hit.start < kept.end && hit.end > kept.start)) continue;
    taken.push(hit);
  }
  return taken;
}

function countBefore(line, start, previousEnd) {
  const slice = line.slice(previousEnd, start);
  let count = 1;
  for (const [word, value] of Object.entries(COUNTS)) {
    if (new RegExp(`\\b${word}\\b`).test(slice)) count = value;
  }
  return count;
}

function slotFields(hits) {
  const fields = {};
  for (let n = 1; n <= 3; n += 1) {
    const hit = hits[n - 1];
    fields[`spawn${n}Query`] = hit?.query ?? null;
    fields[`spawn${n}Count`] = hit?.count ?? null;
    fields[`spawn${n}Attitude`] = hit?.attitude ?? null;
    fields[`spawn${n}Proximity`] = null;
  }
  return fields;
}

function intent(scene) {
  const line = scene.split('Player: ').at(-1).toLowerCase();
  const here = present(scene).join(' ');
  const strike =
    /\b(stab|attack|shoot|swing|finish|strike|loose|cast|hurl|unleash|fire|blast|conjure)\b/.test(
      line,
    );
  let previousEnd = 0;
  const hits = findHits(line)
    .map((hit) => {
      const count = countBefore(line, hit.start, previousEnd);
      previousEnd = hit.end;
      return { ...hit, count };
    })
    .filter((hit) => !here.includes(hit.query.split(' ')[0]));
  const isNew = !strike && hits.length > 0;
  return {
    spawnIsNew: isNew,
    ...slotFields(isNew ? hits : []),
    checkAbility: null,
    checkSkill: null,
    wantsAction: strike,
  };
}

function decision(scene) {
  const [actionBlock, targetBlock] = scene.split('Targets:\n');
  const actions = actionBlock
    .split('Actions:\n')[1]
    .split('\n')
    .filter((l) => /^A\d/.test(l));
  const targets = targetBlock
    .split('\n\n')[0]
    .split('\n')
    .filter((l) => /^T\d/.test(l));
  const line = scene.split('Player: ').at(-1).toLowerCase();
  if (!actions.length) return NONE;
  const wanted = SPELLS.find(([say]) => say.test(line));
  const named = wanted && actions.find((a) => wanted[1].test(a));
  // A spell the player names but the menu does not offer (no slot, not castable): do nothing.
  if (wanted && !named && /cast|spell|missile|burning|bolt/.test(line)) return NONE;
  if (!wanted && /\b(cast|fireball|mage hand|conjure)\b/.test(line)) return NONE;
  const action = named ?? actions.find((a) => /dagger/i.test(a)) ?? actions[0];
  const max = Number(/up to (\d) targets/.exec(action)?.[1] ?? 1);

  const word = WORDS.find(([w]) => new RegExp(`\\b${w}s?\\b`).test(line))?.[1].split(' ')[0];
  const last = scene.match(/use (T\d+) \(/)?.[1];
  const pool = targets.filter((t) => !word || t.toLowerCase().includes(word));
  const nth = ORDINALS.map((o, i) => (line.includes(o) ? i : -1)).filter((i) => i >= 0);
  // "two darts on the first goblin, one on the second": one slot per dart, repeats kept.
  const darts = [
    ...line.matchAll(
      /\b(one|two|three|[123]) (?:darts? )?(?:on|at|to|into|for) the (first|second|third)/g,
    ),
  ].flatMap(([, n, ord]) => Array(DART_COUNTS[n]).fill(pool[ORDINALS.indexOf(ord)]));
  let picked;
  if (/magic missile/i.test(action) && darts.length > 0 && darts.every(Boolean)) {
    picked = darts.slice(0, max);
  } else if (max > 1 && /\b(all|both|each|every|them)\b/.test(line)) picked = pool.slice(0, max);
  else if (max > 1 && nth.length) picked = nth.map((i) => pool[i]).filter(Boolean);
  else if (nth.length) picked = [pool[nth[0]]].filter(Boolean);
  else picked = [pool[0] ?? targets.find((t) => t.startsWith(`${last} `)) ?? targets[0]];
  const alias = (t) => t?.split(' ')[0] ?? null;
  const needs = !/\bno target\b/.test(action);
  return {
    kind: 'action',
    actionAlias: action.split(' ')[0],
    targetAlias: needs ? alias(picked[0]) : null,
    secondaryTargetAlias: needs && max > 1 ? alias(picked[1]) : null,
    tertiaryTargetAlias: needs && max > 1 ? alias(picked[2]) : null,
  };
}

export function createOracleClient() {
  const answer = { turn_intent: intent, decision };
  return {
    async generateObject({ name, schema, prompt }) {
      const raw = answer[name](prompt.scene);
      const data = schema.parse(raw);
      return { data, attempts: [{ rawText: JSON.stringify(raw) }], usage: null, totalLatencyMs: 0 };
    },
    async generateText() {
      return { text: 'Steel rings in the gloom.', attempts: [], usage: null, totalLatencyMs: 0 };
    },
    async *streamText() {
      yield 'Steel rings in the gloom.';
    },
  };
}
