import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { execSync } from 'node:child_process';
import { detectFeature } from '../../src/lib/feature-detect.js';
import type { WorkspaceConfig } from '../../src/lib/types.js';

function makeTmpDir(): string {
  return fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-detect-feature-test-')),
  );
}

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

function initRepo(dir: string): void {
  git(dir, 'init -b main');
  git(dir, 'config user.email "test@test.com"');
  git(dir, 'config user.name "Test"');
  fs.writeFileSync(path.join(dir, 'README.md'), '# init\n');
  git(dir, 'add .');
  git(dir, 'commit -m "initial commit"');
}

function writeWorkspaceConfig(dir: string, config: WorkspaceConfig): void {
  const configDir = path.join(dir, '.spwn');
  fs.mkdirSync(configDir, { recursive: true });
  fs.writeFileSync(
    path.join(configDir, 'workspace.json'),
    JSON.stringify(config, null, 2),
    'utf-8',
  );
}

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

describe('detectFeature', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns feature name when current branch matches a registered feature', async () => {
    const repoPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoPath);
    initRepo(repoPath);
    git(repoPath, 'checkout -b my-feature');

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
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: ['repo-a'] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await detectFeature({ workspaceDir: tmpDir });
    expect(result).toBe('my-feature');
  });

  it('returns feature name when any materialized repo branch matches', async () => {
    const repoAPath = path.join(tmpDir, 'repo-a');
    const repoBPath = path.join(tmpDir, 'repo-b');
    fs.mkdirSync(repoAPath);
    fs.mkdirSync(repoBPath);
    initRepo(repoAPath);
    initRepo(repoBPath);

    // repo-a stays on main, repo-b is on the feature branch
    git(repoBPath, 'checkout -b cool-feature');

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
        { name: 'cool-feature', createdAt: new Date().toISOString(), repos: ['repo-b'] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await detectFeature({ workspaceDir: tmpDir });
    expect(result).toBe('cool-feature');
  });

  it('throws helpful error listing available features when no match', async () => {
    const repoPath = path.join(tmpDir, 'repo-a');
    fs.mkdirSync(repoPath);
    initRepo(repoPath);
    // repo-a stays on main, which is not a registered feature

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
        { name: 'feat-auth', createdAt: new Date().toISOString(), repos: [] },
        { name: 'feat-ui', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    await expect(detectFeature({ workspaceDir: tmpDir })).rejects.toThrow(
      /feat-auth.*feat-ui|feat-ui.*feat-auth/,
    );
    await expect(detectFeature({ workspaceDir: tmpDir })).rejects.toThrow(
      /auto-detect/i,
    );
  });

  it('works when explicitly provided (passthrough)', async () => {
    const config = makeConfig({
      features: [
        { name: 'my-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    const result = await detectFeature({
      workspaceDir: tmpDir,
      explicit: 'my-feature',
    });
    expect(result).toBe('my-feature');
  });

  it('throws error when explicit feature is not registered', async () => {
    const config = makeConfig({
      features: [
        { name: 'real-feature', createdAt: new Date().toISOString(), repos: [] },
      ],
    });
    writeWorkspaceConfig(tmpDir, config);

    await expect(
      detectFeature({ workspaceDir: tmpDir, explicit: 'nonexistent' }),
    ).rejects.toThrow(/not registered/i);
    await expect(
      detectFeature({ workspaceDir: tmpDir, explicit: 'nonexistent' }),
    ).rejects.toThrow(/real-feature/);
  });
});
