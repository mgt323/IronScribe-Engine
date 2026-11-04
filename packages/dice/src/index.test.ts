import { describe, expect, it } from 'vitest';

import { name } from './index.js';

describe('dice', () => {
  it('exports its package name', () => {
    expect(name).toBe('dice');
  });
});
