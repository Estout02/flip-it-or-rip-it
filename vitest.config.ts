import { defineConfig } from 'vitest/config';

// The API suite only. The web client in web/ is its own package with its own
// Vitest config (jsdom); without this scope the root run would collect its tests
// in a Node environment and fail them.
export default defineConfig({
  test: {
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
