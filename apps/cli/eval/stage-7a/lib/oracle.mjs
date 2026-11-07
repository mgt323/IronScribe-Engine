/**
 * `--provider oracle`: a rule-based stand-in for the model. It reads the same prompts a
 * real model gets and answers with simple string rules. Two uses: prove the harness and
 * the engine invariants without a server (a failure with the oracle is not a model
 * problem), and give the benchmark a ceiling to compare real models against.
 */
const WORDS = [
  ['wolf', 'wolf', 'hostile'],
  ['wolves', 'wolf', 'hostile'],
  ['bear', 'brown bear', 'hostile'],
  ['goblin', 'goblin', 'hostile'],
  ['guard', 'guard', 'friendly'],
  ['cultist', 'cultist', 'neutral'],
  ['dragon', 'dragon', 'hostile'],
];
const COUNTS = { two: 2, three: 3, four: 4 };
const ORDINALS = ['first', 'second', 'third', 'fourth'];

const present = (scene) =>
  scene
    .split('Present:\n')[1]
    ?.split('\n\n')[0]
    .split('\n')
    .map((l) => l.toLowerCase()) ?? [];

const NONE = {
  kind: 'none',
  actionAlias: null,
  targetAlias: null,
  secondaryTargetAlias: null,
  tertiaryTargetAlias: null,
};

function intent(scene) {
  const line = scene.split('Player: ').at(-1).toLowerCase();
  const here = present(scene).join(' ');
  const strike = /\b(stab|attack|shoot|swing|finish|strike|loose)\b/.test(line);
  const hit = WORDS.find(([w]) => new RegExp(`\\b${w}s?\\b`).test(line));
  const spawnIsNew =
    !!hit && !strike && !/\b(another)\b/.test(line)
      ? !here.includes(hit[1].split(' ')[0])
      : /\banother\b/.test(line);
  const count =
    Object.entries(COUNTS).find(([w]) => new RegExp(`\\b${w}s?\\b`).test(line))?.[1] ?? 1;
  return {
    spawnIsNew,
    spawnQuery: spawnIsNew ? hit[1] : null,
    spawnCount: spawnIsNew ? count : null,
    spawnAttitude: spawnIsNew ? hit[2] : null,
    checkAbility: null,
    checkSkill: null,
    wantsAction: strike,
  };
}

function decision(scene) {
  const [actionBlock, targetBlock] = scene.split('Targets:\n');
  const actions = actionBlock
    .split('Actions:\n')[1]
    .trim()
    .split('\n')
    .filter((l) => /^A\d/.test(l));
  const targets = targetBlock
    .split('\n\n')[0]
    .split('\n')
    .filter((l) => /^T\d/.test(l));
  const line = scene.split('Player: ').at(-1).toLowerCase();
  if (!actions.length) return NONE;
  const bow = /bow|shoot|arrow/.test(line);
  const action = actions.find((a) => (bow ? /shortbow/i : /dagger/i).test(a)) ?? actions[0];
  const word = WORDS.find(([w]) => new RegExp(`\\b${w}s?\\b`).test(line))?.[1].split(' ')[0];
  const last = scene.match(/use (T\d+) \(/)?.[1];
  let pool = targets.filter((t) => !word || t.toLowerCase().includes(word));
  const nth = ORDINALS.findIndex((o) => line.includes(o));
  if (nth >= 0 && pool[nth]) pool = [pool[nth]];
  const fallback =
    !word && nth < 0 && last ? targets.find((t) => t.startsWith(`${last} `)) : undefined;
  const target = (fallback ?? pool[0] ?? targets[0])?.split(' ')[0] ?? null;
  const needs = !/\bno target\b/.test(action);
  return {
    kind: 'action',
    actionAlias: action.split(' ')[0],
    targetAlias: needs ? target : null,
    secondaryTargetAlias: null,
    tertiaryTargetAlias: null,
  };
}

export function createOracleClient() {
  const answer = {
    turn_intent: intent,
    decision,
  };
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
