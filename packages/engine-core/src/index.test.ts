import { describe, expect, it } from 'vitest';

import { name } from './index.js';

describe('engine-core', () => {
  it('exports its package name', () => {
    expect(name).toBe('engine-core');
  });
});
