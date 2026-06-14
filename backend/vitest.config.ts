import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    env: {
      // Default to the disposable test DB from docker-compose.test.yml (`npm run test:db:up`).
      // Override with TEST_DATABASE_URL for the in-network/docker path (see Dockerfile.test + CI).
      TEST_DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? 'postgresql://primeloop:primeloop_test@127.0.0.1:55432/primeloop_test',
    },
  },
})
