import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    // Node by default; component tests opt into jsdom with a file-level
    // `// @vitest-environment jsdom` pragma. better-sqlite3 cannot load in jsdom.
    environment: 'node',
    include: ['tests/unit/**/*.test.ts', 'tests/unit/**/*.test.tsx', 'tests/integration/**/*.test.ts'],
    setupFiles: ['tests/setup.ts'],
    // T1 iterates the whole corpus; the default 5s timeout is not enough.
    testTimeout: 120_000,
    hookTimeout: 120_000,
    coverage: {
      provider: 'v8',
      reportsDirectory: 'coverage',
      reporter: ['text-summary', 'json-summary', 'html'],
      include: ['lib/**/*.ts', 'components/**/*.tsx', 'features/**/*.ts', 'hooks/**/*.ts'],
      exclude: ['**/*.d.ts', 'lib/db/client.ts'],
      thresholds: {
        // §12.3 — everything else
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
        // §12.3 — no exceptions for the trusted computing base and the parser
        'lib/core/**/*.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
        'lib/parser/**/*.ts': { statements: 100, branches: 100, functions: 100, lines: 100 },
      },
    },
  },
});
