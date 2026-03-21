import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { deleteFeature } from '../../src/lib/branch.js';
import { writeConfig, readConfig } from '../../src/lib/workspace.js';
import type { WorkspaceConfig } from '../../src/lib/types.js';

const gitEnv = {
  ...process.env,
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@test.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@test.com',
};

function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-delete-test-')));
}

function initRepo(dir: string, name: string): string {
  const repoPath = path.join(dir, name);
  fs.mkdirSync(repoPath, { recursive: true });
  execSync('git init', { cwd: repoPath, env: gitEnv, stdio: 'pipe' });
  execSync('git checkout -b main', { cwd: repoPath, env: gitEnv, stdio: 'pipe' });
  fs.writeFileSync(path.join(repoPath, 'file.txt'), 'hello\n');
  execSync('git add .', { cwd: repoPath, env: gitEnv, stdio: 'pipe' });
  execSync('git commit -m "init"', { cwd: repoPath, env: gitEnv, stdio: 'pipe' });
  return repoPath;
}

function makeConfig(dir: string, features: WorkspaceConfig['features']): WorkspaceConfig {
  return {
    version: 1,
    name: 'test-ws',
    repos: [
      { name: 'repo-a', path: './repo-a', url: 'git@github.com:test/repo-a.git', defaultBranch: 'main', packageName: 'repo-a', manifestType: 'package.json' },
      { name: 'repo-b', path: './repo-b', url: 'git@github.com:test/repo-b.git', defaultBranch: 'main', packageName: 'repo-b', manifestType: 'package.json' },
    ],
    dependencies: [],
    features,
    lastUpdated: new Date().toISOString(),
  };
}

describe('deleteFeature', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('removes feature from workspace config', async () => {
    initRepo(tmpDir, 'repo-a');
    initRepo(tmpDir, 'repo-b');

    const config = makeConfig(tmpDir, [
      { name: 'feat-1', createdAt: new Date().toISOString(), repos: [] },
      { name: 'feat-2', createdAt: new Date().toISOString(), repos: [] },
    ]);
    await writeConfig(tmpDir, config);

    const result = await deleteFeature({ workspaceDir: tmpDir, featureName: 'feat-1' });

    expect(result.deleted).toBe(true);
    expect(result.branchesDeleted).toEqual([]);

    const updated = await readConfig(tmpDir);
    expect(updated.features).toHaveLength(1);
    expect(updated.features[0].name).toBe('feat-2');
  });

  it('deletes git branches in materialized repos when deleteBranches=true', async () => {
    const repoA = initRepo(tmpDir, 'repo-a');
    initRepo(tmpDir, 'repo-b');

    // Create feature branch in repo-a
    execSync('git branch feat-1', { cwd: repoA, env: gitEnv, stdio: 'pipe' });

    const config = makeConfig(tmpDir, [
      { name: 'feat-1', createdAt: new Date().toISOString(), repos: ['repo-a'] },
    ]);
    await writeConfig(tmpDir, config);

    const result = await deleteFeature({
      workspaceDir: tmpDir,
      featureName: 'feat-1',
      deleteBranches: true,
    });

    expect(result.deleted).toBe(true);
    expect(result.branchesDeleted).toContain('repo-a');

    // Verify git branch was deleted
    const branches = execSync('git branch --list feat-1', { cwd: repoA, encoding: 'utf-8' });
    expect(branches.trim()).toBe('');
  });

  it('skips branch deletion if repo is on that branch', async () => {
    const repoA = initRepo(tmpDir, 'repo-a');
    initRepo(tmpDir, 'repo-b');

    // Create and checkout feature branch
    execSync('git checkout -b feat-1', { cwd: repoA, env: gitEnv, stdio: 'pipe' });

    const config = makeConfig(tmpDir, [
      { name: 'feat-1', createdAt: new Date().toISOString(), repos: ['repo-a'] },
    ]);
    await writeConfig(tmpDir, config);

    const result = await deleteFeature({
      workspaceDir: tmpDir,
      featureName: 'feat-1',
      deleteBranches: true,
    });

    expect(result.deleted).toBe(true);
    expect(result.branchesSkipped).toContain('repo-a');
  });

  it('errors if feature does not exist', async () => {
    initRepo(tmpDir, 'repo-a');
    const config = makeConfig(tmpDir, []);
    await writeConfig(tmpDir, config);

    await expect(
      deleteFeature({ workspaceDir: tmpDir, featureName: 'nonexistent' }),
    ).rejects.toThrow(/not found/i);
  });

  it('removes feature even without deleteBranches (config-only)', async () => {
    const repoA = initRepo(tmpDir, 'repo-a');
    initRepo(tmpDir, 'repo-b');

    execSync('git branch feat-1', { cwd: repoA, env: gitEnv, stdio: 'pipe' });

    const config = makeConfig(tmpDir, [
      { name: 'feat-1', createdAt: new Date().toISOString(), repos: ['repo-a'] },
    ]);
    await writeConfig(tmpDir, config);

    const result = await deleteFeature({
      workspaceDir: tmpDir,
      featureName: 'feat-1',
      deleteBranches: false,
    });

    expect(result.deleted).toBe(true);
    expect(result.branchesDeleted).toEqual([]);

    // Git branch should still exist
    const branches = execSync('git branch --list feat-1', { cwd: repoA, encoding: 'utf-8' });
    expect(branches.trim()).not.toBe('');
  });
});
