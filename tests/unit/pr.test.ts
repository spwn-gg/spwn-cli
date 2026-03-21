import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { GitHubAdapter } from '../../src/lib/github.js';
import type {
  WorkspaceConfig,
  RepoConfig,
  DependencyEdge,
  FeatureBranch,
} from '../../src/lib/types.js';

// Mock modules before imports
vi.mock('../../src/lib/github.js', () => ({
  createGitHubAdapter: vi.fn(),
  parseRepoUrl: vi.fn((url: string) => {
    const match = url.match(
      /(?:github\.com)[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/,
    );
    if (!match) throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
    return { owner: match[1], repo: match[2] };
  }),
}));

vi.mock('../../src/lib/git.js', () => ({
  getCommitsAhead: vi.fn(),
  isGitRepo: vi.fn(() => true),
  getRemoteUrl: vi.fn(),
  getDefaultBranch: vi.fn(() => 'main'),
  getCurrentBranch: vi.fn(),
  isDirty: vi.fn(() => false),
  createBranch: vi.fn(),
  checkoutBranch: vi.fn(),
  branchExists: vi.fn(),
}));

vi.mock('../../src/lib/workspace.js', () => ({
  readConfig: vi.fn(),
}));

import { createPRs, generatePRBody } from '../../src/lib/pr.js';
import { createGitHubAdapter } from '../../src/lib/github.js';
import { getCommitsAhead } from '../../src/lib/git.js';
import { readConfig } from '../../src/lib/workspace.js';

function makeRepo(name: string, defaultBranch = 'main'): RepoConfig {
  return {
    name,
    path: `./${name}`,
    url: `https://github.com/testorg/${name}.git`,
    defaultBranch,
    packageName: `@testorg/${name}`,
    manifestType: 'package.json',
  };
}

function makeConfig(overrides: Partial<WorkspaceConfig> = {}): WorkspaceConfig {
  const repos = overrides.repos ?? [
    makeRepo('shared-lib'),
    makeRepo('backend'),
    makeRepo('frontend'),
  ];
  const dependencies: DependencyEdge[] = overrides.dependencies ?? [
    {
      from: 'backend',
      to: 'shared-lib',
      type: 'runtime',
      packageName: '@testorg/shared-lib',
    },
    {
      from: 'frontend',
      to: 'backend',
      type: 'runtime',
      packageName: '@testorg/backend',
    },
  ];
  const features: FeatureBranch[] = overrides.features ?? [
    {
      name: 'feat/add-auth',
      createdAt: '2026-01-01T00:00:00.000Z',
      repos: ['shared-lib', 'backend', 'frontend'],
    },
  ];
  return {
    version: 1,
    name: 'test-workspace',
    repos,
    dependencies,
    features,
    lastUpdated: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function makeMockAdapter(): GitHubAdapter & {
  createPR: ReturnType<typeof vi.fn>;
  getPRStatus: ReturnType<typeof vi.fn>;
  mergePR: ReturnType<typeof vi.fn>;
  getCommitsAhead: ReturnType<typeof vi.fn>;
  findPR: ReturnType<typeof vi.fn>;
} {
  return {
    createPR: vi.fn(),
    getPRStatus: vi.fn(),
    mergePR: vi.fn(),
    getCommitsAhead: vi.fn(),
    findPR: vi.fn(),
  };
}

describe('createPRs', () => {
  let mockAdapter: ReturnType<typeof makeMockAdapter>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAdapter = makeMockAdapter();
    vi.mocked(createGitHubAdapter).mockReturnValue(mockAdapter);
    // Set a token in env
    process.env.GH_TOKEN = 'fake-token';
  });

  afterEach(() => {
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;
  });

  it('identifies repos with materialized branches that have commits ahead of default branch', async () => {
    const config = makeConfig();
    vi.mocked(readConfig).mockResolvedValue(config);

    // shared-lib and backend have commits, frontend does not
    vi.mocked(getCommitsAhead)
      .mockReturnValueOnce(3) // shared-lib
      .mockReturnValueOnce(5) // backend
      .mockReturnValueOnce(0); // frontend

    mockAdapter.createPR
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/shared-lib/pull/42',
        number: 42,
      })
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/backend/pull/103',
        number: 103,
      });

    const results = await createPRs({
      workspaceDir: '/workspace',
      featureName: 'feat/add-auth',
      title: 'Add auth',
      body: 'Adds authentication',
    });

    // Should have created PRs for shared-lib and backend only
    expect(mockAdapter.createPR).toHaveBeenCalledTimes(2);

    const created = results.filter((r) => !r.skipped);
    expect(created).toHaveLength(2);
    expect(created[0].repoName).toBe('shared-lib');
    expect(created[1].repoName).toBe('backend');
  });

  it('PR body includes cross-reference table with other PR URLs and dependency order', async () => {
    const config = makeConfig();
    vi.mocked(readConfig).mockResolvedValue(config);

    vi.mocked(getCommitsAhead)
      .mockReturnValueOnce(3) // shared-lib
      .mockReturnValueOnce(5) // backend
      .mockReturnValueOnce(2); // frontend

    mockAdapter.createPR
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/shared-lib/pull/42',
        number: 42,
      })
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/backend/pull/103',
        number: 103,
      })
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/frontend/pull/67',
        number: 67,
      });

    await createPRs({
      workspaceDir: '/workspace',
      featureName: 'feat/add-auth',
      title: 'Add auth',
      body: 'Adds authentication',
    });

    // Check the body of the first PR call includes coordinated PRs section
    const firstCallBody = mockAdapter.createPR.mock.calls[0][0].body as string;
    expect(firstCallBody).toContain('Coordinated PRs');
    expect(firstCallBody).toContain('Dependency Order');
    expect(firstCallBody).toContain('shared-lib');
    expect(firstCallBody).toContain('backend');
    expect(firstCallBody).toContain('frontend');
  });

  it('repos with no changes (0 commits ahead) are skipped with skipReason', async () => {
    const config = makeConfig();
    vi.mocked(readConfig).mockResolvedValue(config);

    vi.mocked(getCommitsAhead)
      .mockReturnValueOnce(0) // shared-lib: no changes
      .mockReturnValueOnce(0) // backend: no changes
      .mockReturnValueOnce(0); // frontend: no changes

    const results = await createPRs({
      workspaceDir: '/workspace',
      featureName: 'feat/add-auth',
      title: 'Add auth',
      body: 'Adds authentication',
    });

    expect(mockAdapter.createPR).not.toHaveBeenCalled();
    expect(results).toHaveLength(3);
    for (const result of results) {
      expect(result.skipped).toBe(true);
      expect(result.skipReason).toBeDefined();
      expect(result.skipReason).toContain('no commits ahead');
    }
  });

  it('returns PRCreateResult array with URLs and numbers', async () => {
    const config = makeConfig();
    vi.mocked(readConfig).mockResolvedValue(config);

    vi.mocked(getCommitsAhead)
      .mockReturnValueOnce(3) // shared-lib
      .mockReturnValueOnce(5) // backend
      .mockReturnValueOnce(0); // frontend - skipped

    mockAdapter.createPR
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/shared-lib/pull/42',
        number: 42,
      })
      .mockResolvedValueOnce({
        url: 'https://github.com/testorg/backend/pull/103',
        number: 103,
      });

    const results = await createPRs({
      workspaceDir: '/workspace',
      featureName: 'feat/add-auth',
      title: 'Add auth',
      body: 'Adds authentication',
    });

    expect(results).toHaveLength(3);

    expect(results[0]).toEqual({
      repoName: 'shared-lib',
      prUrl: 'https://github.com/testorg/shared-lib/pull/42',
      prNumber: 42,
      skipped: false,
    });
    expect(results[1]).toEqual({
      repoName: 'backend',
      prUrl: 'https://github.com/testorg/backend/pull/103',
      prNumber: 103,
      skipped: false,
    });
    expect(results[2]).toMatchObject({
      repoName: 'frontend',
      skipped: true,
    });
  });

  it('handles auth failure gracefully (throws descriptive error)', async () => {
    delete process.env.GH_TOKEN;
    delete process.env.GITHUB_TOKEN;

    const config = makeConfig();
    vi.mocked(readConfig).mockResolvedValue(config);

    vi.mocked(getCommitsAhead).mockReturnValue(3);

    await expect(
      createPRs({
        workspaceDir: '/workspace',
        featureName: 'feat/add-auth',
        title: 'Add auth',
        body: 'Adds authentication',
      }),
    ).rejects.toThrow(/GH_TOKEN|GITHUB_TOKEN|token/i);
  });

  it('skips repos not materialized in the feature', async () => {
    const config = makeConfig({
      features: [
        {
          name: 'feat/add-auth',
          createdAt: '2026-01-01T00:00:00.000Z',
          repos: ['shared-lib'], // Only shared-lib is materialized
        },
      ],
    });
    vi.mocked(readConfig).mockResolvedValue(config);

    vi.mocked(getCommitsAhead).mockReturnValueOnce(3); // shared-lib

    mockAdapter.createPR.mockResolvedValueOnce({
      url: 'https://github.com/testorg/shared-lib/pull/42',
      number: 42,
    });

    const results = await createPRs({
      workspaceDir: '/workspace',
      featureName: 'feat/add-auth',
      title: 'Add auth',
      body: 'Adds authentication',
    });

    // Only shared-lib should be checked; backend and frontend are not materialized
    expect(vi.mocked(getCommitsAhead)).toHaveBeenCalledTimes(1);
    expect(mockAdapter.createPR).toHaveBeenCalledTimes(1);

    const created = results.filter((r) => !r.skipped);
    expect(created).toHaveLength(1);
    expect(created[0].repoName).toBe('shared-lib');
  });
});

describe('generatePRBody', () => {
  it('generates markdown with cross-reference table and dependency order', () => {
    const body = generatePRBody({
      title: 'Add auth',
      body: 'Adds authentication',
      currentRepo: 'backend',
      prMap: new Map([
        ['shared-lib', { url: 'https://github.com/testorg/shared-lib/pull/42', number: 42 }],
        ['backend', { url: 'https://github.com/testorg/backend/pull/103', number: 103 }],
        ['frontend', { url: 'https://github.com/testorg/frontend/pull/67', number: 67 }],
      ]),
      dependencyOrder: ['shared-lib', 'backend', 'frontend'],
    });

    expect(body).toContain('Adds authentication');
    expect(body).toContain('Coordinated PRs');
    expect(body).toContain('shared-lib');
    expect(body).toContain('backend');
    expect(body).toContain('frontend');
    expect(body).toContain('this PR');
    expect(body).toContain('Dependency Order');
    expect(body).toContain('spwn');
  });
});
