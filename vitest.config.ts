import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Tests run against a real Postgres: globalSetup makes sure one is
    // reachable, and setupFiles gives each test file its own empty schema
    // in it (so files are isolated from each other and from any dev data).
    globalSetup: './vitest.global-setup.ts',
    setupFiles: ['./vitest.setup.ts'],
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
