import { describe, expect, it } from 'vitest';

import { name } from './index.js';

describe('orchestrator', () => {
  it('exports its package name', () => {
    expect(name).toBe('orchestrator');
  });
});
