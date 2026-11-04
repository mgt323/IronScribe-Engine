import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'system-dnd5e-2024',
    include: ['src/**/*.test.ts'],
  },
});
