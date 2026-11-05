import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { RAW_DIR } from './paths.js';
import type { RawFiles } from './raw-types.js';

/**
 * Read a committed raw file. No Zod: the data was validated at import time and in
 * tests (raw-validation.test.ts), and does not change while the game runs.
 */
export function readRaw<K extends keyof RawFiles>(file: K): readonly RawFiles[K][] {
  return JSON.parse(readFileSync(join(RAW_DIR, file), 'utf8')) as RawFiles[K][];
}
