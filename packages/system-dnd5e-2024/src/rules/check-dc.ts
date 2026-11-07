import type { CheckDcContext, CheckDifficultyBand, GameState } from '@iron-scribe/engine-core';

import { HIDE_DC, hideAllowed } from './hide.js';

/**
 * SRD 5.2.1 Typical Difficulty Classes. Medium is 15.
 * DC 12 is not on this table.
 */
export const SRD_TYPICAL_DC = {
  veryEasy: 5,
  easy: 10,
  medium: 15,
  hard: 20,
  veryHard: 25,
  nearlyImpossible: 30,
} as const satisfies Record<CheckDifficultyBand, number>;

/**
 * Temporary Stage 6 fallback for a free-text check with no difficulty band.
 * Not an SRD value. The handoff scene uses Stealth against DC 12.
 */
export const PROJECT_DEFAULT_CHECK_DC = 12;

/**
 * Engine-owned DC. A difficulty band uses the SRD table. A legal Hide is DC 15.
 * Anything else uses the project fallback (12), which is not an SRD band.
 */
export function resolveDndCheckDc(state: GameState, context: CheckDcContext): number {
  if (context.difficulty) return SRD_TYPICAL_DC[context.difficulty];
  if (context.skill === 'stealth' && hideAllowed(state, context.actorId)) return HIDE_DC;
  return PROJECT_DEFAULT_CHECK_DC;
}
