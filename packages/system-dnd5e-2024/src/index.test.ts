import { describe, expect, it } from 'vitest';

import { name } from './index.js';

describe('system-dnd5e-2024', () => {
  it('exports its package name', () => {
    expect(name).toBe('system-dnd5e-2024');
  });
});
