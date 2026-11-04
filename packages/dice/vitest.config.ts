import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'dice',
    include: ['src/**/*.test.ts'],
  },
});
