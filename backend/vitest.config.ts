import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    fileParallelism: false,
    env: {
      TEST_DATABASE_URL: process.env['TEST_DATABASE_URL'] ?? 'postgresql://langgraph:CHANGEME_password@127.0.0.1:5434/agent_cp_test',
    },
  },
})
