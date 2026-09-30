// vitest.config.ts
// Unit tests for the pure maths in src/lib (calculators, BOM costing, paper
// stock). Node environment — nothing here renders. The @/ alias mirrors
// tsconfig's paths so tests import exactly what the app imports.

import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
