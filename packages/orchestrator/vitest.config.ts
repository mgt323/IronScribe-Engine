import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'orchestrator',
    include: ['src/**/*.test.ts'],
  },
});
