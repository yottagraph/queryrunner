import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';

// Map Nuxt's `~` / `@` aliases to the repo root so server-util modules import
// cleanly under vitest. We only test pure logic here (no Nuxt runtime), so a
// plain node environment is enough.
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
    resolve: {
        alias: { '~': root, '@': root },
    },
    test: {
        environment: 'node',
        include: ['test/**/*.test.ts'],
    },
});
