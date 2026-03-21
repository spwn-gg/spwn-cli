import { Octokit } from 'octokit';
import type { PRStatus } from './types.js';

export interface GitHubAdapter {
  createPR(options: {
    owner: string;
    repo: string;
    head: string;
    base: string;
    title: string;
    body: string;
    draft?: boolean;
  }): Promise<{ url: string; number: number }>;

  getPRStatus(options: {
    owner: string;
    repo: string;
    prNumber: number;
  }): Promise<PRStatus>;

  mergePR(options: {
    owner: string;
    repo: string;
    prNumber: number;
    method?: 'merge' | 'squash' | 'rebase';
  }): Promise<{ merged: boolean; sha: string }>;

  getCommitsAhead(options: {
    owner: string;
    repo: string;
    base: string;
    head: string;
  }): Promise<number>;

  findPR(options: {
    owner: string;
    repo: string;
    head: string;
    base: string;
  }): Promise<{ url: string; number: number } | null>;
}

export function createGitHubAdapter(token: string): GitHubAdapter {
  const octokit = new Octokit({ auth: token });

  return {
    async createPR({ owner, repo, head, base, title, body, draft }) {
      const { data } = await octokit.rest.pulls.create({
        owner,
        repo,
        head,
        base,
        title,
        body,
        draft: draft ?? false,
      });
      return { url: data.html_url, number: data.number };
    },

    async getPRStatus({ owner, repo, prNumber }) {
      const { data: pr } = await octokit.rest.pulls.get({
        owner,
        repo,
        pull_number: prNumber,
      });

      // Get CI checks
      let ci: PRStatus['ci'] = 'none';
      try {
        const { data: checks } = await octokit.rest.checks.listForRef({
          owner,
          repo,
          ref: pr.head.sha,
        });
        if (checks.total_count === 0) {
          ci = 'none';
        } else if (
          checks.check_runs.every((c) => c.conclusion === 'success')
        ) {
          ci = 'pass';
        } else if (checks.check_runs.some((c) => c.conclusion === 'failure')) {
          ci = 'fail';
        } else if (
          checks.check_runs.some(
            (c) => c.status === 'in_progress' || c.status === 'queued',
          )
        ) {
          ci = 'running';
        } else {
          ci = 'pending';
        }
      } catch {
        ci = 'none';
      }

      // Get reviews
      const { data: reviews } = await octokit.rest.pulls.listReviews({
        owner,
        repo,
        pull_number: prNumber,
      });

      const approved = reviews.filter((r) => r.state === 'APPROVED').length;
      const changesRequested = reviews.filter(
        (r) => r.state === 'CHANGES_REQUESTED',
      ).length;
      const pending = reviews.filter(
        (r) => r.state === 'PENDING',
      ).length;

      return {
        number: pr.number,
        url: pr.html_url,
        state: pr.state === 'open' ? 'open' : pr.merged ? 'merged' : 'closed',
        mergeable: pr.mergeable,
        ci,
        reviews: { approved, changesRequested, pending },
      };
    },

    async mergePR({ owner, repo, prNumber, method }) {
      const { data } = await octokit.rest.pulls.merge({
        owner,
        repo,
        pull_number: prNumber,
        merge_method: method ?? 'merge',
      });
      return { merged: data.merged, sha: data.sha };
    },

    async getCommitsAhead({ owner, repo, base, head }) {
      const { data } = await octokit.rest.repos.compareCommits({
        owner,
        repo,
        base,
        head,
      });
      return data.ahead_by;
    },

    async findPR({ owner, repo, head, base }) {
      const { data } = await octokit.rest.pulls.list({
        owner,
        repo,
        head: `${owner}:${head}`,
        base,
        state: 'open',
      });
      if (data.length === 0) return null;
      return { url: data[0].html_url, number: data[0].number };
    },
  };
}

export function parseRepoUrl(url: string): { owner: string; repo: string } {
  const match = url.match(
    /(?:github\.com)[/:]([^/]+)\/([^/.]+?)(?:\.git)?$/,
  );
  if (!match) {
    throw new Error(`Cannot parse GitHub repo from URL: ${url}`);
  }
  return { owner: match[1], repo: match[2] };
}
