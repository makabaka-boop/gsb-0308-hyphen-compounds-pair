import { defineConfig } from 'vitest/config';

export default defineConfig({
  base: './',
  build: {
    target: 'es2020',
  },
  test: {
    environment: 'node',
    include: ['test/**/*.test.ts'],
  },
});
