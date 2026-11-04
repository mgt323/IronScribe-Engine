export type KeepMode = 'highest' | 'lowest';

export interface KeepSpec {
  readonly mode: KeepMode;
  readonly count: number;
}

export interface DiceTerm {
  readonly kind: 'dice';
  readonly sign: 1 | -1;
  readonly count: number;
  readonly sides: number;
  readonly keep?: KeepSpec;
}

export interface ConstantTerm {
  readonly kind: 'constant';
  readonly sign: 1 | -1;
  readonly value: number;
}

export type FormulaTerm = DiceTerm | ConstantTerm;

export interface DiceFormula {
  readonly terms: readonly FormulaTerm[];
}

export class DiceFormulaError extends Error {
  readonly position: number;

  constructor(message: string, position: number) {
    super(message);
    this.name = 'DiceFormulaError';
    this.position = position;
  }
}

const MIN_COUNT = 1;
const MAX_COUNT = 100;
const MIN_SIDES = 2;
const MAX_SIDES = 1000;

function isDigit(ch: string): boolean {
  return ch >= '0' && ch <= '9';
}

class Parser {
  private readonly text: string;
  private pos = 0;

  constructor(text: string) {
    this.text = text;
  }

  parse(): DiceFormula {
    this.skipWs();
    if (this.pos >= this.text.length) {
      throw new DiceFormulaError('Empty dice formula', 0);
    }

    const terms: FormulaTerm[] = [];
    let sign: 1 | -1 = 1;

    // Optional leading sign.
    if (this.peek() === '+' || this.peek() === '-') {
      sign = this.readSign();
    }

    terms.push(this.parseTerm(sign));

    while (this.pos < this.text.length) {
      this.skipWs();
      if (this.pos >= this.text.length) {
        break;
      }
      const op = this.peek();
      if (op !== '+' && op !== '-') {
        throw new DiceFormulaError(`Expected '+' or '-', found '${op ?? ''}'`, this.pos);
      }
      sign = this.readSign();
      terms.push(this.parseTerm(sign));
    }

    return { terms };
  }

  private parseTerm(sign: 1 | -1): FormulaTerm {
    this.skipWs();
    const start = this.pos;
    if (this.pos >= this.text.length) {
      throw new DiceFormulaError('Expected a dice or constant term', start);
    }

    // Bare `dM` or `NdM` or integer.
    if (this.peekLower() === 'd') {
      this.pos += 1;
      const sides = this.readPositiveInt('die sides');
      this.checkSides(sides, start);
      const keep = this.parseKeep(start);
      const term: DiceTerm = keep
        ? { kind: 'dice', sign, count: 1, sides, keep }
        : { kind: 'dice', sign, count: 1, sides };
      return term;
    }

    if (!isDigit(this.peek() ?? '')) {
      throw new DiceFormulaError(`Unexpected character '${this.peek() ?? ''}'`, this.pos);
    }

    const number = this.readPositiveInt('number');
    this.skipWs();

    if (this.peekLower() === 'd') {
      this.pos += 1;
      const count = number;
      this.checkCount(count, start);
      const sides = this.readPositiveInt('die sides');
      this.checkSides(sides, start);
      const keep = this.parseKeep(start);
      const term: DiceTerm = keep
        ? { kind: 'dice', sign, count, sides, keep }
        : { kind: 'dice', sign, count, sides };
      return term;
    }

    return { kind: 'constant', sign, value: number };
  }

  private parseKeep(termStart: number): KeepSpec | undefined {
    this.skipWs();
    const ch = this.peekLower();
    if (ch !== 'k') {
      return undefined;
    }
    this.pos += 1;
    const modeChar = this.peekLower();
    let mode: KeepMode;
    if (modeChar === 'h') {
      mode = 'highest';
      this.pos += 1;
    } else if (modeChar === 'l') {
      mode = 'lowest';
      this.pos += 1;
    } else {
      throw new DiceFormulaError("Expected 'kh' or 'kl' after 'k'", this.pos);
    }
    const count = this.readPositiveInt('keep count');
    if (count < MIN_COUNT || count > MAX_COUNT) {
      throw new DiceFormulaError(
        `Keep count must be ${String(MIN_COUNT)}..${String(MAX_COUNT)}`,
        termStart,
      );
    }
    return { mode, count };
  }

  private checkCount(count: number, position: number): void {
    if (count < MIN_COUNT || count > MAX_COUNT) {
      throw new DiceFormulaError(
        `Die count must be ${String(MIN_COUNT)}..${String(MAX_COUNT)}`,
        position,
      );
    }
  }

  private checkSides(sides: number, position: number): void {
    if (sides < MIN_SIDES || sides > MAX_SIDES) {
      throw new DiceFormulaError(
        `Die sides must be ${String(MIN_SIDES)}..${String(MAX_SIDES)}`,
        position,
      );
    }
  }

  private readSign(): 1 | -1 {
    this.skipWs();
    const ch = this.peek();
    if (ch === '-') {
      this.pos += 1;
      return -1;
    }
    if (ch === '+') {
      this.pos += 1;
      return 1;
    }
    throw new DiceFormulaError(`Expected '+' or '-'`, this.pos);
  }

  private readPositiveInt(label: string): number {
    this.skipWs();
    const start = this.pos;
    if (!isDigit(this.peek() ?? '')) {
      throw new DiceFormulaError(`Expected ${label}`, start);
    }
    while (isDigit(this.peek() ?? '')) {
      this.pos += 1;
    }
    const raw = this.text.slice(start, this.pos);
    // Leading zeros are fine; Number is exact for our small limits.
    const value = Number(raw);
    if (!Number.isInteger(value) || value < 0) {
      throw new DiceFormulaError(`Invalid ${label}`, start);
    }
    return value;
  }

  private skipWs(): void {
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch !== ' ' && ch !== '\t' && ch !== '\n' && ch !== '\r') {
        break;
      }
      this.pos += 1;
    }
  }

  private peek(): string | undefined {
    return this.text[this.pos];
  }

  private peekLower(): string | undefined {
    const ch = this.peek();
    return ch === undefined ? undefined : ch.toLowerCase();
  }
}

export function parseFormula(text: string): DiceFormula {
  return new Parser(text).parse();
}

function formatDiceTerm(term: DiceTerm): string {
  let body = `${String(term.count)}d${String(term.sides)}`;
  if (term.keep) {
    const letter = term.keep.mode === 'highest' ? 'h' : 'l';
    body += `k${letter}${String(term.keep.count)}`;
  }
  return body;
}

export function formatFormula(formula: DiceFormula): string {
  if (formula.terms.length === 0) {
    throw new DiceFormulaError('Empty dice formula', 0);
  }

  let out = '';
  for (let i = 0; i < formula.terms.length; i += 1) {
    const term = formula.terms[i];
    if (term === undefined) {
      continue;
    }
    const body = term.kind === 'dice' ? formatDiceTerm(term) : String(term.value);
    if (i === 0) {
      out += term.sign === -1 ? `-${body}` : body;
    } else {
      out += term.sign === -1 ? `-${body}` : `+${body}`;
    }
  }
  return out;
}
