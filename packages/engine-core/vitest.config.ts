import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'engine-core',
    include: ['src/**/*.test.ts'],
  },
});
