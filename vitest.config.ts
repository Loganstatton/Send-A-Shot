import path from 'path';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // Each test file gets its own process/module registry, so setting
    // DATA_DIR before importing lib/db.ts (in lib/db.test.ts) isolates it
    // from the real dev/prod database.
    fileParallelism: false,
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
});
