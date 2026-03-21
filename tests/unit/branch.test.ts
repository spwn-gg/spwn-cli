import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { registerBranch, checkout } from '../../src/lib/branch.js';
import type { WorkspaceConfig } from '../../src/lib/types.js';

/** Helper: create a temporary directory and return its real path. */
function makeTmpDir(): string {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-branch-test-')),
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

/** Helper: read workspace config from disk. */
function readWorkspaceConfig(dir: string): WorkspaceConfig {
  const content = fs.readFileSync(
    path.join(dir, '.spwn', 'workspace.json'),
    'utf-8',
  );
  return JSON.parse(content) as WorkspaceConfig;
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

describe('registerBranch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('adds a feature to config with empty repos array', async () => {
    const config = makeConfig();
    writeWorkspaceConfig(tmpDir, config);

    const result = await registerBranch({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
    });

    expect(result.name).toBe('my-feature');
    expect(result.repos).toEqual([]);
    expect(result.createdAt).toBeTruthy();
  });

  it('rejects duplicate feature name', async () => {
    const config = makeConfig({
      features: [
        { name: 'existing-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      registerBranch({ workspaceDir: tmpDir, featureName: 'existing-feature' }),
    ).rejects.toThrow(/already exists/i);
  });

  it('validates feature name (alphanumeric + hyphens)', async () => {
    const config = makeConfig();
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      registerBranch({ workspaceDir: tmpDir, featureName: 'bad name!' }),
    ).rejects.toThrow(/invalid/i);

    await expect(
      registerBranch({ workspaceDir: tmpDir, featureName: 'bad/slash' }),
    ).rejects.toThrow(/invalid/i);

    await expect(
      registerBranch({ workspaceDir: tmpDir, featureName: '' }),
    ).rejects.toThrow(/invalid/i);
  });

  it('persists updated config to disk', async () => {
    const config = makeConfig();
    writeWorkspaceConfig(tmpDir, config);

    await registerBranch({ workspaceDir: tmpDir, featureName: 'persisted-feature' });

    const saved = readWorkspaceConfig(tmpDir);
    expect(saved.features).toHaveLength(1);
    expect(saved.features[0].name).toBe('persisted-feature');
    expect(saved.features[0].repos).toEqual([]);
  });
});

describe('checkout', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates git branch in specified repo only', async () => {
    // Set up two repos
    const repoAPath = path.join(tmpDir, 'repo-a');
    const repoBPath = path.join(tmpDir, 'repo-b');
    fs.mkdirSync(repoAPath);
    fs.mkdirSync(repoBPath);
    initRepo(repoAPath);
    initRepo(repoBPath);

    const config = makeConfig({
      repos: [
        {
          name: 'repo-a',
          path: './repo-a',
          url: '',
          defaultBranch: 'main',
          packageName: 'repo-a',
          manifestType: 'package.json',
        },
        {
          name: 'repo-b',
          path: './repo-b',
          url: '',
          defaultBranch: 'main',
          packageName: 'repo-b',
          manifestType: 'package.json',
        },
      ],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await checkout({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
      repoName: 'repo-a',
    });

    expect(result.repoName).toBe('repo-a');
    expect(result.branchName).toBe('my-feature');
    expect(result.created).toBe(true);

    // Verify repo-a is on the branch
    const branchA = git(repoAPath, 'rev-parse --abbrev-ref HEAD');
    expect(branchA).toBe('my-feature');

    // Verify repo-b is still on main
    const branchB = git(repoBPath, 'rev-parse --abbrev-ref HEAD');
    expect(branchB).toBe('main');
  });

  it('updates feature.repos in config after checkout', async () => {
    const repoPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoPath);
    initRepo(repoPath);

    const config = makeConfig({
      repos: [
        {
          name: 'repo-a',
          path: './repo-a',
          url: '',
          defaultBranch: 'main',
          packageName: 'repo-a',
          manifestType: 'package.json',
        },
      ],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    await checkout({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
      repoName: 'repo-a',
    });

    const saved = readWorkspaceConfig(tmpDir);
    const feature = saved.features.find((f) => f.name === 'my-feature');
    expect(feature).toBeDefined();
    expect(feature!.repos).toContain('repo-a');
  });

  it('errors when repo is dirty and force=false', async () => {
    const repoPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoPath);
    initRepo(repoPath);
    // Make it dirty
    fs.writeFileSync(path.join(repoPath, 'dirty.txt'), 'uncommitted\n');

    const config = makeConfig({
      repos: [
        {
          name: 'repo-a',
          path: './repo-a',
          url: '',
          defaultBranch: 'main',
          packageName: 'repo-a',
          manifestType: 'package.json',
        },
      ],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      checkout({
        workspaceDir: tmpDir,
        featureName: 'my-feature',
        repoName: 'repo-a',
        force: false,
      }),
    ).rejects.toThrow(/dirty/i);
  });

  it('allows checkout when repo is dirty and force=true', async () => {
    const repoPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoPath);
    initRepo(repoPath);
    // Make it dirty
    fs.writeFileSync(path.join(repoPath, 'dirty.txt'), 'uncommitted\n');

    const config = makeConfig({
      repos: [
        {
          name: 'repo-a',
          path: './repo-a',
          url: '',
          defaultBranch: 'main',
          packageName: 'repo-a',
          manifestType: 'package.json',
        },
      ],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await checkout({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
      repoName: 'repo-a',
      force: true,
    });

    expect(result.repoName).toBe('repo-a');
    expect(result.created).toBe(true);
  });

  it('handles existing branch conflict (switches to it)', async () => {
    const repoPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoPath);
    initRepo(repoPath);
    // Pre-create the branch
    git(repoPath, 'branch my-feature');

    const config = makeConfig({
      repos: [
        {
          name: 'repo-a',
          path: './repo-a',
          url: '',
          defaultBranch: 'main',
          packageName: 'repo-a',
          manifestType: 'package.json',
        },
      ],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await checkout({
      workspaceDir: tmpDir,
      featureName: 'my-feature',
      repoName: 'repo-a',
    });

    expect(result.created).toBe(false);
    const currentBranch = git(repoPath, 'rev-parse --abbrev-ref HEAD');
    expect(currentBranch).toBe('my-feature');
  });

  it('rejects unknown repo name', async () => {
    const config = makeConfig({
      repos: [],
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      checkout({
        workspaceDir: tmpDir,
        featureName: 'my-feature',
        repoName: 'nonexistent-repo',
      }),
    ).rejects.toThrow(/not found|unknown/i);
  });

  it('rejects unregistered feature name', async () => {
    const config = makeConfig({ repos: [], features: [] });
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      checkout({
        workspaceDir: tmpDir,
        featureName: 'not-registered',
        repoName: 'some-repo',
      }),
    ).rejects.toThrow(/not found|not registered|unknown/i);
  });
});
