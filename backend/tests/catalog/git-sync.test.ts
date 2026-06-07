// T033: Git sync provenance integration tests.
//
// Verifies FR-013 (import from a Git commit SHA), FR-014 (moving ref resolves
// to an immutable SHA), and SC-003 (provenance recorded on every version).
//
// Uses a real local git repo created in a temp directory — no remote required.

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';

import pg from 'pg';
import { createPool, runMigrations } from '../../src/db.js';
import { createCatalogStore } from '../../src/catalog/store.js';
import { syncFromGitSource } from '../../src/catalog/admission.js';
import { resolveRefToSha } from '../../src/catalog/source.js';

const TEST_DB =
  process.env.TEST_DATABASE_URL ?? 'postgresql://primeloop:primeloop_dev@127.0.0.1:5434/primeloop_test';

const VALID_YAML = `\
templateId: git-test-template
name: Git Test Template
version: "1.0.0"
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: ephemeral
soul: "Test soul."
systemPrompt: "Test prompt."
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: []
approvalPolicy:
  autoEligible: false
`;

const VALID_YAML_V2 = `\
templateId: git-test-template
name: Git Test Template v2
version: "2.0.0"
agentType: opencode
runtimeFamily: opencode
lifecycleIntent: ephemeral
soul: "Test soul v2."
systemPrompt: "Test prompt v2."
capabilityProfile:
  platformPrimitives: [soul.read]
  capabilityBundles: []
approvalPolicy:
  autoEligible: false
`;

const GIT_ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
  GIT_CONFIG_NOSYSTEM: '1',
};

/** Create a bare-minimum local git repo with one YAML template, return sha. */
function makeGitRepo(dir: string, yamlContent: string, message: string): string {
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe', env: GIT_ENV });
  run('git init');
  run('git config user.name Test');
  run('git config user.email test@test.com');
  writeFileSync(join(dir, 'template.yaml'), yamlContent);
  run('git add template.yaml');
  run(`git commit --no-gpg-sign -m "${message}"`);
  return run('git rev-parse HEAD').toString().trim();
}

/** Add a new commit to an existing repo with updated YAML. Returns new SHA. */
function addGitCommit(dir: string, yamlContent: string, message: string): string {
  const run = (cmd: string) => execSync(cmd, { cwd: dir, stdio: 'pipe', env: GIT_ENV });
  writeFileSync(join(dir, 'template.yaml'), yamlContent);
  run('git add template.yaml');
  run(`git commit --no-gpg-sign -m "${message}"`);
  return run('git rev-parse HEAD').toString().trim();
}

describe('Catalog Git Sync - provenance (T033)', () => {
  let pool: pg.Pool;
  let sourceId: string;
  let repoDirs: string[] = [];

  function freshRepo(): string {
    const dir = mkdtempSync(join(tmpdir(), 'catalog-git-repo-'));
    repoDirs.push(dir);
    return dir;
  }

  beforeAll(async () => {
    pool = createPool(TEST_DB);
    await runMigrations(pool);
    const store = createCatalogStore(pool);
    sourceId = await store.createSource({
      kind: 'git',
      name: `git-test-source-${Date.now()}`,
      location: '/tmp/placeholder',  // overridden per test
      enabled: true,
    });
  });

  afterAll(async () => {
    for (const dir of repoDirs) rmSync(dir, { recursive: true, force: true });
    await pool.end();
  });

  beforeEach(async () => {
    await pool.query('DELETE FROM catalog_admission_events');
    await pool.query('DELETE FROM catalog_template_versions');
    await pool.query('DELETE FROM catalog_templates');
  });

  it('resolves a branch name to a concrete immutable SHA (FR-014)', async () => {
    const dir = freshRepo();
    makeGitRepo(dir, VALID_YAML, 'initial commit');
    const sha = await resolveRefToSha(dir, 'HEAD');
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
  });

  it('records the resolved commit SHA on every imported version (FR-013, SC-003)', async () => {
    const dir = freshRepo();
    const expectedSha = makeGitRepo(dir, VALID_YAML, 'commit for provenance test');

    const results = await syncFromGitSource({ pool, sourceId, repoPath: dir, ref: 'HEAD' });

    expect(results).toHaveLength(1);
    expect(results[0].outcome).toBe('admitted');
    expect(results[0].templateId).toBe('git-test-template');

    const store = createCatalogStore(pool);
    const tmpl = await store.getTemplateByTemplateId('git-test-template');
    const versions = await store.listVersions(tmpl!.id);
    expect(versions[0].commitSha).toBe(expectedSha);
    expect(versions[0].sourceRef).toBe('HEAD');
  });

  it('syncing a second commit creates a new version while retaining the first (versioning)', async () => {
    const dir = freshRepo();
    makeGitRepo(dir, VALID_YAML, 'v1');
    await syncFromGitSource({ pool, sourceId, repoPath: dir, ref: 'HEAD' });

    const sha2 = addGitCommit(dir, VALID_YAML_V2, 'v2');
    await syncFromGitSource({ pool, sourceId, repoPath: dir, ref: 'HEAD' });

    const store = createCatalogStore(pool);
    const tmpl = await store.getTemplateByTemplateId('git-test-template');
    const versions = await store.listVersions(tmpl!.id);

    expect(versions.length).toBeGreaterThanOrEqual(2);
    expect(versions.find(v => v.version === '2.0.0')?.commitSha).toBe(sha2);
    expect(versions.find(v => v.version === '1.0.0')).toBeDefined();
  });

  it('syncing the same SHA twice is idempotent (duplicate outcome)', async () => {
    const dir = freshRepo();
    makeGitRepo(dir, VALID_YAML, 'idempotent test');
    const sha = execSync('git rev-parse HEAD', { cwd: dir }).toString().trim();

    const first = await syncFromGitSource({ pool, sourceId, repoPath: dir, ref: sha });
    const second = await syncFromGitSource({ pool, sourceId, repoPath: dir, ref: sha });

    expect(first[0].outcome).toBe('admitted');
    expect(second[0].outcome).toBe('duplicate');
  });
});
