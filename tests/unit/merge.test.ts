import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubAdapter } from '../../src/lib/github.js';
import type {
  WorkspaceConfig,
  PRStatus,
} from '../../src/lib/types.js';

// Mock workspace module
vi.mock('../../src/lib/workspace.js', () => ({
  readConfig: vi.fn(),
}));

// Mock github module
vi.mock('../../src/lib/github.js', () => ({
  createGitHubAdapter: vi.fn(),
  parseRepoUrl: vi.fn(),
}));

import { readConfig } from '../../src/lib/workspace.js';
import { createGitHubAdapter, parseRepoUrl } from '../../src/lib/github.js';
import { merge } from '../../src/lib/merge.js';

const mockReadConfig = vi.mocked(readConfig);
const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockParseRepoUrl = vi.mocked(parseRepoUrl);

function makeConfig(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    version: 1,
    name: 'test-workspace',
    repos: [
      {
        name: 'shared-lib',
        path: './shared-lib',
        url: 'https://github.com/owner/shared-lib.git',
        defaultBranch: 'main',
        packageName: '@test/shared-lib',
        manifestType: 'package.json',
      },
      {
        name: 'backend',
        path: './backend',
        url: 'https://github.com/owner/backend.git',
        defaultBranch: 'main',
        packageName: '@test/backend',
        manifestType: 'package.json',
      },
      {
        name: 'frontend',
        path: './frontend',
        url: 'https://github.com/owner/frontend.git',
        defaultBranch: 'main',
        packageName: '@test/frontend',
        manifestType: 'package.json',
      },
    ],
    dependencies: [
      {
        from: 'backend',
        to: 'shared-lib',
        type: 'runtime',
        packageName: '@test/shared-lib',
      },
      {
        from: 'frontend',
        to: 'backend',
        type: 'runtime',
        packageName: '@test/backend',
      },
    ],
    features: [
      {
        name: 'feat-1',
        createdAt: '2026-01-01T00:00:00.000Z',
        repos: ['shared-lib', 'backend', 'frontend'],
      },
    ],
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makePRStatus(overrides?: Partial<PRStatus>): PRStatus {
  return {
    number: 1,
    url: 'https://github.com/owner/repo/pull/1',
    state: 'open',
    mergeable: true,
    ci: 'pass',
    reviews: { approved: 1, changesRequested: 0, pending: 0 },
    ...overrides,
  };
}

function createMockAdapter(): GitHubAdapter {
  return {
    createPR: vi.fn(),
    getPRStatus: vi.fn(),
    mergePR: vi.fn(),
    getCommitsAhead: vi.fn(),
    findPR: vi.fn(),
  };
}

describe('merge', () => {
  let mockAdapter: ReturnType<typeof createMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = createMockAdapter();
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);
    mockParseRepoUrl.mockImplementation((url: string) => {
      const name = url.replace('https://github.com/owner/', '').replace('.git', '');
      return { owner: 'owner', repo: name };
    });
  });

  it('merges in topological order (leaves first): shared-lib before backend before frontend', async () => {
    mockReadConfig.mockResolvedValue(makeConfig());

    const mergeOrder: string[] = [];

    vi.mocked(mockAdapter.findPR).mockImplementation(async ({ repo }) => {
      const prNumbers: Record<string, number> = { 'shared-lib': 10, backend: 20, frontend: 30 };
      return { url: `https://github.com/owner/${repo}/pull/${prNumbers[repo]}`, number: prNumbers[repo] };
    });

    vi.mocked(mockAdapter.getPRStatus).mockImplementation(async ({ repo, prNumber }) => {
      return makePRStatus({ number: prNumber, url: `https://github.com/owner/${repo}/pull/${prNumber}` });
    });

    vi.mocked(mockAdapter.mergePR).mockImplementation(async ({ repo }) => {
      mergeOrder.push(repo);
      return { merged: true, sha: 'abc123' };
    });

    const result = await merge({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
    });

    expect(result.allMerged).toBe(true);
    expect(mergeOrder).toEqual(['shared-lib', 'backend', 'frontend']);
    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].repoName).toBe('shared-lib');
    expect(result.steps[1].repoName).toBe('backend');
    expect(result.steps[2].repoName).toBe('frontend');
  });

  it('polls CI status between merges', async () => {
    mockReadConfig.mockResolvedValue(makeConfig());

    const getPRStatusCalls: string[] = [];

    vi.mocked(mockAdapter.findPR).mockImplementation(async ({ repo }) => {
      const prNumbers: Record<string, number> = { 'shared-lib': 10, backend: 20, frontend: 30 };
      return { url: `https://github.com/owner/${repo}/pull/${prNumbers[repo]}`, number: prNumbers[repo] };
    });

    vi.mocked(mockAdapter.getPRStatus).mockImplementation(async ({ repo, prNumber }) => {
      getPRStatusCalls.push(repo);
      return makePRStatus({ number: prNumber, url: `https://github.com/owner/${repo}/pull/${prNumber}` });
    });

    vi.mocked(mockAdapter.mergePR).mockResolvedValue({ merged: true, sha: 'abc123' });

    await merge({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
      pollDelayMs: 0,
    });

    // getPRStatus should be called for each repo before merging
    expect(getPRStatusCalls).toContain('shared-lib');
    expect(getPRStatusCalls).toContain('backend');
    expect(getPRStatusCalls).toContain('frontend');
  });

  it('halts on CI failure with guidance message', async () => {
    mockReadConfig.mockResolvedValue(makeConfig());

    vi.mocked(mockAdapter.findPR).mockImplementation(async ({ repo }) => {
      const prNumbers: Record<string, number> = { 'shared-lib': 10, backend: 20, frontend: 30 };
      return { url: `https://github.com/owner/${repo}/pull/${prNumbers[repo]}`, number: prNumbers[repo] };
    });

    vi.mocked(mockAdapter.getPRStatus).mockImplementation(async ({ repo, prNumber }) => {
      if (repo === 'backend') {
        return makePRStatus({ number: prNumber, ci: 'fail' });
      }
      return makePRStatus({ number: prNumber });
    });

    vi.mocked(mockAdapter.mergePR).mockResolvedValue({ merged: true, sha: 'abc123' });

    const result = await merge({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
      pollDelayMs: 0,
      maxRetries: 1,
    });

    expect(result.allMerged).toBe(false);
    expect(result.failedAt).toBe('backend');
    expect(result.guidance).toBeDefined();
    expect(result.guidance).toContain('CI');
    // shared-lib should have been merged, but backend and frontend should not
    expect(result.steps[0].status).toBe('merged');
    expect(result.steps[1].status).toBe('failed');
  });

  it('dry-run returns merge plan without executing merges', async () => {
    mockReadConfig.mockResolvedValue(makeConfig());

    vi.mocked(mockAdapter.findPR).mockImplementation(async ({ repo }) => {
      const prNumbers: Record<string, number> = { 'shared-lib': 10, backend: 20, frontend: 30 };
      return { url: `https://github.com/owner/${repo}/pull/${prNumbers[repo]}`, number: prNumbers[repo] };
    });

    vi.mocked(mockAdapter.getPRStatus).mockImplementation(async ({ prNumber }) => {
      return makePRStatus({ number: prNumber });
    });

    const result = await merge({
      workspaceDir: '/test',
      featureName: 'feat-1',
      githubToken: 'fake-token',
      dryRun: true,
      pollDelayMs: 0,
    });

    expect(result.steps).toHaveLength(3);
    expect(result.steps[0].repoName).toBe('shared-lib');
    expect(result.steps[0].status).toBe('skipped');
    expect(result.steps[1].repoName).toBe('backend');
    expect(result.steps[2].repoName).toBe('frontend');
    expect(result.allMerged).toBe(false);
    expect(mockAdapter.mergePR).not.toHaveBeenCalled();
  });

  it('respects merge method option (merge/squash/rebase passed to adapter)', async () => {
    mockReadConfig.mockResolvedValue(makeConfig());

    vi.mocked(mockAdapter.findPR).mockImplementation(async ({ repo }) => {
      const prNumbers: Record<string, number> = { 'shared-lib': 10, backend: 20, frontend: 30 };
      return { url: `https://github.com/owner/${repo}/pull/${prNumbers[repo]}`, number: prNumbers[repo] };
    });

    vi.mocked(mockAdapter.getPRStatus).mockImplementation(async ({ prNumber }) => {
      return makePRStatus({ number: prNumber });
    });

    vi.mocked(mockAdapter.mergePR).mockResolvedValue({ merged: true, sha: 'abc123' });

    for (const method of ['merge', 'squash', 'rebase'] as const) {
      vi.mocked(mockAdapter.mergePR).mockClear();

      await merge({
        workspaceDir: '/test',
        featureName: 'feat-1',
        githubToken: 'fake-token',
        method,
        pollDelayMs: 0,
      });

      const calls = vi.mocked(mockAdapter.mergePR).mock.calls;
      for (const call of calls) {
        expect(call[0].method).toBe(method);
      }
    }
  });
});
