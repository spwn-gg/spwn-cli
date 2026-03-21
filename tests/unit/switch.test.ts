import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { switchFeature } from '../../src/lib/branch.js';
import type { WorkspaceConfig } from '../../src/lib/types.js';

/** Helper: create a temporary directory and return its real path. */
function makeTmpDir(): string {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-switch-test-')),
  );
}

/** Helper: run a git command inside a directory. */
function git(repoPath: string, args: string): string {
  return execSync(`git ${args}`, {
    cwd: repoPath,
    encoding: 'utf-8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Test',
      GIT_AUTHOR_EMAIL: 'test@test.com',
      GIT_COMMITTER_NAME: 'Test',
      GIT_COMMITTER_EMAIL: 'test@test.com',
    },
  }).trim();
}

/** Helper: initialise a git repo with an initial commit. */
function initRepo(dir: string): void {
  git(dir, 'init -b main');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  fs.writeFileSync(path.join(dir, 'README.md'), '# init\n');
  git(dir, 'add .');
  git(dir, 'commit -m "initial commit"');
}

/** Helper: create a workspace config in a directory. */
function writeWorkspaceConfig(
  dir: string,
  config: WorkspaceConfig,
): void {
  const configDir = path.join(dir, '.spwn');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'workspace.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

/** Helper: create a minimal workspace config. */
function makeConfig(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    version: 1,
    name: 'test-workspace',
    repos: [],
    dependencies: [],
    features: [],
    lastUpdated: new Date().toISOString(),
    ...overrides,
  };
}

function makeRepo(name: string): WorkspaceConfig['repos'][number] {
  return {
    name,
    path: `./${name}`,
    url: '',
    defaultBranch: 'main',
    packageName: name,
    manifestType: 'package.json',
  };
}

describe('switchFeature', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('checks out feature branch in all materialized repos', async () => {
    const repoAPath = path.join(tmpDir, 'repo-a');
    const repoBPath = path.join(tmpDir, 'repo-b');
    fs.mkdirSync(repoAPath);
    fs.mkdirSync(repoBPath);
    initRepo(repoAPath);
    initRepo(repoBPath);

    // Create the feature branch in both repos
    git(repoAPath, 'branch my-feature');
    git(repoBPath, 'branch my-feature');

    const config = makeConfig({
      repos: [makeRepo('repo-a'), makeRepo('repo-b')],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: ['repo-a', 'repo-b'] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await switchFeature({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
    });

    expect(result.switched).toEqual(['repo-a', 'repo-b']);
    expect(result.skipped).toEqual([]);

    // Verify both repos are on the feature branch
    expect(git(repoAPath, 'rev-parse --abbrev-ref HEAD')).toBe('my-feature');
    expect(git(repoBPath, 'rev-parse --abbrev-ref HEAD')).toBe('my-feature');
  });

  it('skips repos not materialized for this feature', async () => {
    const repoAPath = path.join(tmpDir, 'repo-a');
    const repoBPath = path.join(tmpDir, 'repo-b');
    fs.mkdirSync(repoAPath);
    fs.mkdirSync(repoBPath);
    initRepo(repoAPath);
    initRepo(repoBPath);

    // Only create feature branch in repo-a
    git(repoAPath, 'branch my-feature');

    const config = makeConfig({
      repos: [makeRepo('repo-a'), makeRepo('repo-b')],
      features: [
        // Only repo-a is in the feature's repos array
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: ['repo-a'] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await switchFeature({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
    });

    expect(result.switched).toEqual(['repo-a']);
    expect(result.skipped).toEqual([]);

    // repo-a switched, repo-b still on main
    expect(git(repoAPath, 'rev-parse --abbrev-ref HEAD')).toBe('my-feature');
    expect(git(repoBPath, 'rev-parse --abbrev-ref HEAD')).toBe('main');
  });

  it('errors if feature not registered', async () => {
    const config = makeConfig({ repos: [], features: [] });
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      switchFeature({ workspaceDir: tmpDir, featureName: 'nonexistent' }),
    ).rejects.toThrow(/not found/i);
  });

  it('returns list of switched repos', async () => {
    const repoAPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoAPath);
    initRepo(repoAPath);
    git(repoAPath, 'branch my-feature');

    const config = makeConfig({
      repos: [makeRepo('repo-a')],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: ['repo-a'] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await switchFeature({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
    });

    expect(result.switched).toEqual(['repo-a']);
    expect(Array.isArray(result.switched)).toBe(true);
    expect(Array.isArray(result.skipped)).toBe(true);
  });

  it('warns about dirty repos (skips them, does not error)', async () => {
    const repoAPath = path.join(tmpDir, 'repo-a');
    const repoBPath = path.join(tmpDir, 'repo-b');
    fs.mkdirSync(repoAPath);
    fs.mkdirSync(repoBPath);
    initRepo(repoAPath);
    initRepo(repoBPath);

    git(repoAPath, 'branch my-feature');
    git(repoBPath, 'branch my-feature');

    // Make repo-b dirty
    fs.writeFileSync(path.join(repoBPath, 'dirty.txt'), 'uncommitted\n');

    const config = makeConfig({
      repos: [makeRepo('repo-a'), makeRepo('repo-b')],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: ['repo-a', 'repo-b'] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await switchFeature({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
    });

    expect(result.switched).toEqual(['repo-a']);
    expect(result.skipped).toHaveLength(1);
    expect(result.skipped[0].repoName).toBe('repo-b');
    expect(result.skipped[0].reason).toMatch(/uncommitted/i);

    // repo-a switched, repo-b stayed on main
    expect(git(repoAPath, 'rev-parse --abbrev-ref HEAD')).toBe('my-feature');
    expect(git(repoBPath, 'rev-parse --abbrev-ref HEAD')).toBe('main');
  });
});
