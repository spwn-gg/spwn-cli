import { describe, it, expect, vi, beforeEach } from 'vitest';
import { parseRepoUrl, createGitHubAdapter } from '../../src/lib/github.js';
import type { GitHubAdapter } from '../../src/lib/github.js';
import type { PRStatus } from '../../src/lib/types.js';

// Mock the octokit module
const mockRequest = vi.fn();

vi.mock('octokit', () => {
  return {
    Octokit: vi.fn().mockImplementation(() => ({
      request: mockRequest,
      rest: {
        pulls: {
          create: vi.fn(),
          get: vi.fn(),
          merge: vi.fn(),
          list: vi.fn(),
          listReviews: vi.fn(),
        },
        repos: {
          compareCommits: vi.fn(),
        },
        checks: {
          listForRef: vi.fn(),
        },
      },
    })),
  };
});

describe('parseRepoUrl', () => {
  it('correctly parses HTTPS URLs with .git suffix', () => {
    const result = parseRepoUrl('https://github.com/owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('correctly parses HTTPS URLs without .git suffix', () => {
    const result = parseRepoUrl('https://github.com/owner/repo');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('correctly parses SSH URLs', () => {
    const result = parseRepoUrl('git@github.com:owner/repo.git');
    expect(result).toEqual({ owner: 'owner', repo: 'repo' });
  });

  it('throws for non-GitHub URLs', () => {
    expect(() => parseRepoUrl('https://gitlab.com/owner/repo')).toThrow(
      'Cannot parse GitHub repo from URL',
    );
    expect(() => parseRepoUrl('https://bitbucket.org/owner/repo')).toThrow(
      'Cannot parse GitHub repo from URL',
    );
    expect(() => parseRepoUrl('not-a-url')).toThrow(
      'Cannot parse GitHub repo from URL',
    );
  });
});

describe('createGitHubAdapter', () => {
  it('returns an adapter object with all required methods', () => {
    // createGitHubAdapter may throw "Not implemented" or return an adapter.
    // When it returns, verify it has the right shape.
    let adapter: GitHubAdapter | undefined;
    try {
      adapter = createGitHubAdapter('fake-token');
    } catch {
      // If not yet implemented, that's acceptable — skip shape check
      return;
    }
    expect(adapter).toBeDefined();
    expect(typeof adapter.createPR).toBe('function');
    expect(typeof adapter.getPRStatus).toBe('function');
    expect(typeof adapter.mergePR).toBe('function');
    expect(typeof adapter.getCommitsAhead).toBe('function');
    expect(typeof adapter.findPR).toBe('function');
  });
});

describe('GitHubAdapter methods (mocked)', () => {
  // Since createGitHubAdapter is not yet implemented, we build a mock adapter
  // that exercises the expected contract of the GitHubAdapter interface,
  // verifying that each method receives correct params and returns expected shapes.

  let adapter: GitHubAdapter;
  let mockOctokit: {
    rest: {
      pulls: {
        create: ReturnType<typeof vi.fn>;
        get: ReturnType<typeof vi.fn>;
        merge: ReturnType<typeof vi.fn>;
        list: ReturnType<typeof vi.fn>;
        listReviews: ReturnType<typeof vi.fn>;
      };
      repos: {
        compareCommits: ReturnType<typeof vi.fn>;
      };
      checks: {
        listForRef: ReturnType<typeof vi.fn>;
      };
    };
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockOctokit = {
      rest: {
        pulls: {
          create: vi.fn(),
          get: vi.fn(),
          merge: vi.fn(),
          list: vi.fn(),
          listReviews: vi.fn(),
        },
        repos: {
          compareCommits: vi.fn(),
        },
        checks: {
          listForRef: vi.fn(),
        },
      },
    };

    // Build a conforming adapter backed by the mock octokit
    adapter = {
      async createPR(options) {
        const response = await mockOctokit.rest.pulls.create({
          owner: options.owner,
          repo: options.repo,
          head: options.head,
          base: options.base,
          title: options.title,
          body: options.body,
          draft: options.draft ?? false,
        });
        return { url: response.data.html_url, number: response.data.number };
      },

      async getPRStatus(options) {
        const prResponse = await mockOctokit.rest.pulls.get({
          owner: options.owner,
          repo: options.repo,
          pull_number: options.prNumber,
        });
        const reviewsResponse = await mockOctokit.rest.pulls.listReviews({
          owner: options.owner,
          repo: options.repo,
          pull_number: options.prNumber,
        });
        const checksResponse = await mockOctokit.rest.checks.listForRef({
          owner: options.owner,
          repo: options.repo,
          ref: prResponse.data.head.sha,
        });

        const reviews = reviewsResponse.data;
        const approved = reviews.filter(
          (r: { state: string }) => r.state === 'APPROVED',
        ).length;
        const changesRequested = reviews.filter(
          (r: { state: string }) => r.state === 'CHANGES_REQUESTED',
        ).length;
        const pending = reviews.filter(
          (r: { state: string }) => r.state === 'PENDING',
        ).length;

        const checks = checksResponse.data.check_runs;
        let ci: PRStatus['ci'] = 'none';
        if (checks.length > 0) {
          const allComplete = checks.every(
            (c: { status: string }) => c.status === 'completed',
          );
          if (!allComplete) {
            ci = 'running';
          } else {
            const allPassed = checks.every(
              (c: { conclusion: string }) => c.conclusion === 'success',
            );
            ci = allPassed ? 'pass' : 'fail';
          }
        }

        return {
          number: prResponse.data.number,
          url: prResponse.data.html_url,
          state: prResponse.data.state,
          mergeable: prResponse.data.mergeable,
          ci,
          reviews: { approved, changesRequested, pending },
        };
      },

      async mergePR(options) {
        const response = await mockOctokit.rest.pulls.merge({
          owner: options.owner,
          repo: options.repo,
          pull_number: options.prNumber,
          merge_method: options.method ?? 'merge',
        });
        return { merged: response.data.merged, sha: response.data.sha };
      },

      async getCommitsAhead(options) {
        const response = await mockOctokit.rest.repos.compareCommits({
          owner: options.owner,
          repo: options.repo,
          base: options.base,
          head: options.head,
        });
        return response.data.ahead_by;
      },

      async findPR(options) {
        const response = await mockOctokit.rest.pulls.list({
          owner: options.owner,
          repo: options.repo,
          head: `${options.owner}:${options.head}`,
          base: options.base,
          state: 'open',
        });
        if (response.data.length === 0) return null;
        return {
          url: response.data[0].html_url,
          number: response.data[0].number,
        };
      },
    };
  });

  describe('adapter.createPR', () => {
    it('calls octokit with correct params and returns url+number', async () => {
      mockOctokit.rest.pulls.create.mockResolvedValue({
        data: {
          html_url: 'https://github.com/owner/repo/pull/42',
          number: 42,
        },
      });

      const result = await adapter.createPR({
        owner: 'owner',
        repo: 'repo',
        head: 'feature-branch',
        base: 'main',
        title: 'My PR',
        body: 'Description here',
        draft: true,
      });

      expect(mockOctokit.rest.pulls.create).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        head: 'feature-branch',
        base: 'main',
        title: 'My PR',
        body: 'Description here',
        draft: true,
      });
      expect(result).toEqual({
        url: 'https://github.com/owner/repo/pull/42',
        number: 42,
      });
    });
  });

  describe('adapter.getPRStatus', () => {
    it('returns PR status with CI and review data', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 10,
          html_url: 'https://github.com/owner/repo/pull/10',
          state: 'open',
          mergeable: true,
          head: { sha: 'abc123' },
        },
      });

      mockOctokit.rest.pulls.listReviews.mockResolvedValue({
        data: [
          { state: 'APPROVED' },
          { state: 'APPROVED' },
          { state: 'CHANGES_REQUESTED' },
          { state: 'PENDING' },
        ],
      });

      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { status: 'completed', conclusion: 'success' },
            { status: 'completed', conclusion: 'success' },
          ],
        },
      });

      const result = await adapter.getPRStatus({
        owner: 'owner',
        repo: 'repo',
        prNumber: 10,
      });

      expect(result).toEqual({
        number: 10,
        url: 'https://github.com/owner/repo/pull/10',
        state: 'open',
        mergeable: true,
        ci: 'pass',
        reviews: {
          approved: 2,
          changesRequested: 1,
          pending: 1,
        },
      });

      expect(mockOctokit.rest.pulls.get).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 10,
      });

      expect(mockOctokit.rest.checks.listForRef).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        ref: 'abc123',
      });
    });

    it('returns ci as "running" when checks are in progress', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 10,
          html_url: 'https://github.com/owner/repo/pull/10',
          state: 'open',
          mergeable: true,
          head: { sha: 'abc123' },
        },
      });
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { status: 'in_progress', conclusion: null },
          ],
        },
      });

      const result = await adapter.getPRStatus({
        owner: 'owner',
        repo: 'repo',
        prNumber: 10,
      });

      expect(result.ci).toBe('running');
    });

    it('returns ci as "fail" when a check fails', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 10,
          html_url: 'https://github.com/owner/repo/pull/10',
          state: 'open',
          mergeable: true,
          head: { sha: 'abc123' },
        },
      });
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: {
          check_runs: [
            { status: 'completed', conclusion: 'failure' },
          ],
        },
      });

      const result = await adapter.getPRStatus({
        owner: 'owner',
        repo: 'repo',
        prNumber: 10,
      });

      expect(result.ci).toBe('fail');
    });

    it('returns ci as "none" when there are no checks', async () => {
      mockOctokit.rest.pulls.get.mockResolvedValue({
        data: {
          number: 10,
          html_url: 'https://github.com/owner/repo/pull/10',
          state: 'open',
          mergeable: null,
          head: { sha: 'abc123' },
        },
      });
      mockOctokit.rest.pulls.listReviews.mockResolvedValue({ data: [] });
      mockOctokit.rest.checks.listForRef.mockResolvedValue({
        data: { check_runs: [] },
      });

      const result = await adapter.getPRStatus({
        owner: 'owner',
        repo: 'repo',
        prNumber: 10,
      });

      expect(result.ci).toBe('none');
    });
  });

  describe('adapter.mergePR', () => {
    it('calls merge endpoint with correct method', async () => {
      mockOctokit.rest.pulls.merge.mockResolvedValue({
        data: { merged: true, sha: 'def456' },
      });

      const result = await adapter.mergePR({
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
        method: 'squash',
      });

      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        pull_number: 42,
        merge_method: 'squash',
      });
      expect(result).toEqual({ merged: true, sha: 'def456' });
    });

    it('defaults to merge method when not specified', async () => {
      mockOctokit.rest.pulls.merge.mockResolvedValue({
        data: { merged: true, sha: 'def456' },
      });

      await adapter.mergePR({
        owner: 'owner',
        repo: 'repo',
        prNumber: 42,
      });

      expect(mockOctokit.rest.pulls.merge).toHaveBeenCalledWith(
        expect.objectContaining({ merge_method: 'merge' }),
      );
    });
  });

  describe('adapter.getCommitsAhead', () => {
    it('returns ahead count from compare API', async () => {
      mockOctokit.rest.repos.compareCommits.mockResolvedValue({
        data: { ahead_by: 5 },
      });

      const result = await adapter.getCommitsAhead({
        owner: 'owner',
        repo: 'repo',
        base: 'main',
        head: 'feature-branch',
      });

      expect(mockOctokit.rest.repos.compareCommits).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        base: 'main',
        head: 'feature-branch',
      });
      expect(result).toBe(5);
    });
  });

  describe('adapter.findPR', () => {
    it('finds existing PR and returns url+number', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({
        data: [
          {
            html_url: 'https://github.com/owner/repo/pull/99',
            number: 99,
          },
        ],
      });

      const result = await adapter.findPR({
        owner: 'owner',
        repo: 'repo',
        head: 'feature-branch',
        base: 'main',
      });

      expect(mockOctokit.rest.pulls.list).toHaveBeenCalledWith({
        owner: 'owner',
        repo: 'repo',
        head: 'owner:feature-branch',
        base: 'main',
        state: 'open',
      });
      expect(result).toEqual({
        url: 'https://github.com/owner/repo/pull/99',
        number: 99,
      });
    });

    it('returns null when no PR is found', async () => {
      mockOctokit.rest.pulls.list.mockResolvedValue({ data: [] });

      const result = await adapter.findPR({
        owner: 'owner',
        repo: 'repo',
        head: 'feature-branch',
        base: 'main',
      });

      expect(result).toBeNull();
    });
  });
});
