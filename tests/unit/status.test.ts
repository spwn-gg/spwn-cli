import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubAdapter } from '../../src/lib/github.js';
import type {
  WorkspaceConfig,
  RepoConfig,
  DependencyEdge,
  FeatureBranch,
  PRStatus,
} from '../../src/lib/types.js';

// Mock workspace module
vi.mock('../../src/lib/workspace.js', () => ({
  readConfig: vi.fn(),
}));

// Mock github module
vi.mock('../../src/lib/github.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../src/lib/github.js')>();
  return {
    ...actual,
    createGitHubAdapter: vi.fn(),
    parseRepoUrl: vi.fn(),
  };
});

import { getStatus } from '../../src/lib/status.js';
import { readConfig } from '../../src/lib/workspace.js';
import { createGitHubAdapter, parseRepoUrl } from '../../src/lib/github.js';

const mockReadConfig = vi.mocked(readConfig);
const mockCreateGitHubAdapter = vi.mocked(createGitHubAdapter);
const mockParseRepoUrl = vi.mocked(parseRepoUrl);

function makeRepo(name: string): RepoConfig {
  return {
    name,
    path: `./${name}`,
    url: `https://github.com/owner/${name}.git`,
    defaultBranch: 'main',
    packageName: `@spwn/${name}`,
    manifestType: 'package.json',
  };
}

function edge(from: string, to: string): DependencyEdge {
  return {
    from,
    to,
    type: 'runtime',
    packageName: `@spwn/${to}`,
  };
}

function makeConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  return {
    version: 1,
    name: 'test-workspace',
    repos: [makeRepo('shared'), makeRepo('backend'), makeRepo('frontend')],
    dependencies: [edge('backend', 'shared'), edge('frontend', 'backend')],
    features: [
      {
        name: 'add-auth',
        createdAt: '2024-01-01T00:00:00Z',
        repos: ['shared', 'backend', 'frontend'],
      },
    ],
    lastUpdated: '2024-01-01T00:00:00Z',
    ...overrides,
  };
}

function makeMockAdapter(overrides: Partial<GitHubAdapter> = {}): GitHubAdapter {
  return {
    createPR: vi.fn(),
    getPRStatus: vi.fn(),
    mergePR: vi.fn(),
    getCommitsAhead: vi.fn(),
    findPR: vi.fn(),
    ...overrides,
  };
}

describe('getStatus', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockParseRepoUrl.mockImplementation((url: string) => {
      const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)/);
      if (!match) throw new Error(`Cannot parse: ${url}`);
      return { owner: match[1], repo: match[2] };
    });
  });

  it('returns repos in topological merge order (leaves first)', async () => {
    const config = makeConfig();
    mockReadConfig.mockResolvedValue(config);

    const mockAdapter = makeMockAdapter({
      findPR: vi.fn().mockResolvedValue(null),
    });
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);

    const result = await getStatus({
      workspaceDir: '/fake',
      featureName: 'add-auth',
    });

    const names = result.repos.map((r) => r.repoName);
    // shared has no deps, so it comes first
    // backend depends on shared, so it comes after shared
    // frontend depends on backend, so it comes last
    expect(names.indexOf('shared')).toBeLessThan(names.indexOf('backend'));
    expect(names.indexOf('backend')).toBeLessThan(names.indexOf('frontend'));
  });

  it('CI status aggregation: maps check results to pass/fail/running/pending/none', async () => {
    const config = makeConfig({
      repos: [makeRepo('repo-a')],
      dependencies: [],
      features: [
        { name: 'feat', createdAt: '2024-01-01T00:00:00Z', repos: ['repo-a'] },
      ],
    });
    mockReadConfig.mockResolvedValue(config);

    const prStatus: PRStatus = {
      number: 42,
      url: 'https://github.com/owner/repo-a/pull/42',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 1, changesRequested: 0, pending: 0 },
    };

    const mockAdapter = makeMockAdapter({
      findPR: vi.fn().mockResolvedValue({ url: prStatus.url, number: 42 }),
      getPRStatus: vi.fn().mockResolvedValue(prStatus),
    });
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);

    const result = await getStatus({
      workspaceDir: '/fake',
      featureName: 'feat',
    });

    expect(result.repos[0].ci).toBe('pass');
    expect(result.repos[0].prNumber).toBe(42);
    expect(result.repos[0].prUrl).toBe(prStatus.url);
  });

  it('review status aggregation: counts approved/changesRequested/pending', async () => {
    const config = makeConfig({
      repos: [makeRepo('repo-b')],
      dependencies: [],
      features: [
        { name: 'feat', createdAt: '2024-01-01T00:00:00Z', repos: ['repo-b'] },
      ],
    });
    mockReadConfig.mockResolvedValue(config);

    const prStatus: PRStatus = {
      number: 10,
      url: 'https://github.com/owner/repo-b/pull/10',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 2, changesRequested: 1, pending: 3 },
    };

    const mockAdapter = makeMockAdapter({
      findPR: vi.fn().mockResolvedValue({ url: prStatus.url, number: 10 }),
      getPRStatus: vi.fn().mockResolvedValue(prStatus),
    });
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);

    const result = await getStatus({
      workspaceDir: '/fake',
      featureName: 'feat',
    });

    expect(result.repos[0].reviews).toEqual({
      approved: 2,
      changesRequested: 1,
      pending: 3,
      total: 6,
    });
  });

  it('blocking relationship detection: repo A blocks repo B if A depends on B and B PR is not merged', async () => {
    // backend depends on shared; if shared's PR is open (not merged), backend is blocked by shared
    const config = makeConfig();
    mockReadConfig.mockResolvedValue(config);

    const sharedPR: PRStatus = {
      number: 42,
      url: 'https://github.com/owner/shared/pull/42',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 1, changesRequested: 0, pending: 0 },
    };

    const backendPR: PRStatus = {
      number: 43,
      url: 'https://github.com/owner/backend/pull/43',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 1, changesRequested: 0, pending: 0 },
    };

    const frontendPR: PRStatus = {
      number: 44,
      url: 'https://github.com/owner/frontend/pull/44',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 1, changesRequested: 0, pending: 0 },
    };

    const findPRMock = vi.fn().mockImplementation(
      (opts: { owner: string; repo: string }) => {
        const prMap: Record<string, { url: string; number: number }> = {
          shared: { url: sharedPR.url, number: 42 },
          backend: { url: backendPR.url, number: 43 },
          frontend: { url: frontendPR.url, number: 44 },
        };
        return Promise.resolve(prMap[opts.repo] ?? null);
      },
    );

    const getPRStatusMock = vi.fn().mockImplementation(
      (opts: { repo: string; prNumber: number }) => {
        const statusMap: Record<number, PRStatus> = {
          42: sharedPR,
          43: backendPR,
          44: frontendPR,
        };
        return Promise.resolve(statusMap[opts.prNumber]);
      },
    );

    const mockAdapter = makeMockAdapter({
      findPR: findPRMock,
      getPRStatus: getPRStatusMock,
    });
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);

    const result = await getStatus({
      workspaceDir: '/fake',
      featureName: 'add-auth',
    });

    const backendStatus = result.repos.find((r) => r.repoName === 'backend')!;
    expect(backendStatus.blocking).toContain('shared');

    const frontendStatus = result.repos.find((r) => r.repoName === 'frontend')!;
    expect(frontendStatus.blocking).toContain('backend');

    // shared has no deps so no blocking
    const sharedStatus = result.repos.find((r) => r.repoName === 'shared')!;
    expect(sharedStatus.blocking).toHaveLength(0);
  });

  it('mergeReady flag: true only when all PRs have CI pass + approved reviews', async () => {
    const config = makeConfig({
      repos: [makeRepo('alpha'), makeRepo('beta')],
      dependencies: [edge('beta', 'alpha')],
      features: [
        { name: 'feat', createdAt: '2024-01-01T00:00:00Z', repos: ['alpha', 'beta'] },
      ],
    });
    mockReadConfig.mockResolvedValue(config);

    const alphaPR: PRStatus = {
      number: 1,
      url: 'https://github.com/owner/alpha/pull/1',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 2, changesRequested: 0, pending: 0 },
    };

    const betaPR: PRStatus = {
      number: 2,
      url: 'https://github.com/owner/beta/pull/2',
      state: 'open',
      mergeable: true,
      ci: 'pass',
      reviews: { approved: 1, changesRequested: 0, pending: 0 },
    };

    const findPRMock = vi.fn().mockImplementation(
      (opts: { repo: string }) => {
        if (opts.repo === 'alpha') return Promise.resolve({ url: alphaPR.url, number: 1 });
        if (opts.repo === 'beta') return Promise.resolve({ url: betaPR.url, number: 2 });
        return Promise.resolve(null);
      },
    );

    const getPRStatusMock = vi.fn().mockImplementation(
      (opts: { prNumber: number }) => {
        if (opts.prNumber === 1) return Promise.resolve(alphaPR);
        if (opts.prNumber === 2) return Promise.resolve(betaPR);
        return Promise.resolve(null);
      },
    );

    const mockAdapter = makeMockAdapter({
      findPR: findPRMock,
      getPRStatus: getPRStatusMock,
    });
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);

    const result = await getStatus({
      workspaceDir: '/fake',
      featureName: 'feat',
    });

    expect(result.mergeReady).toBe(true);

    // Now test with a failing CI
    const betaPRFailing: PRStatus = { ...betaPR, ci: 'fail' };
    getPRStatusMock.mockImplementation(
      (opts: { prNumber: number }) => {
        if (opts.prNumber === 1) return Promise.resolve(alphaPR);
        if (opts.prNumber === 2) return Promise.resolve(betaPRFailing);
        return Promise.resolve(null);
      },
    );

    const result2 = await getStatus({
      workspaceDir: '/fake',
      featureName: 'feat',
    });

    expect(result2.mergeReady).toBe(false);
  });

  it('handles repos with no open PRs (prNumber=null, prUrl=null)', async () => {
    const config = makeConfig({
      repos: [makeRepo('lonely')],
      dependencies: [],
      features: [
        { name: 'feat', createdAt: '2024-01-01T00:00:00Z', repos: ['lonely'] },
      ],
    });
    mockReadConfig.mockResolvedValue(config);

    const mockAdapter = makeMockAdapter({
      findPR: vi.fn().mockResolvedValue(null),
    });
    mockCreateGitHubAdapter.mockReturnValue(mockAdapter);

    const result = await getStatus({
      workspaceDir: '/fake',
      featureName: 'feat',
    });

    expect(result.repos).toHaveLength(1);
    expect(result.repos[0].prNumber).toBeNull();
    expect(result.repos[0].prUrl).toBeNull();
    expect(result.repos[0].ci).toBe('none');
    expect(result.repos[0].reviews).toEqual({
      approved: 0,
      changesRequested: 0,
      pending: 0,
      total: 0,
    });
  });
});
