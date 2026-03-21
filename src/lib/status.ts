import type { WorkspaceStatus, RepoStatus } from './types.js';
import { readConfig } from './workspace.js';
import { topologicalSort } from './deps.js';
import { createGitHubAdapter, parseRepoUrl } from './github.js';
import type { GitHubAdapter } from './github.js';

export async function getStatus(options: {
  workspaceDir: string;
  featureName: string;
  githubToken?: string;
}): Promise<WorkspaceStatus> {
  const config = await readConfig(options.workspaceDir);

  // Find the feature
  const feature = config.features.find((f) => f.name === options.featureName);
  if (!feature) {
    throw new Error(
      `Feature '${options.featureName}' not found in workspace '${config.name}'`,
    );
  }

  // Get topological sort of all repos
  const sortResult = topologicalSort(config.repos, config.dependencies);
  if (sortResult.hasCycle) {
    throw new Error(
      `Circular dependency detected: ${sortResult.cycle.join(' -> ')}`,
    );
  }

  // Filter to only materialized repos, preserving topological order
  const materializedSet = new Set(feature.repos);
  const sortedRepos = sortResult.sorted.filter((r) =>
    materializedSet.has(r.name),
  );

  // Create GitHub adapter
  const token = options.githubToken ?? process.env.GITHUB_TOKEN ?? '';
  const github: GitHubAdapter = createGitHubAdapter(token);

  // Build a map to track PR state per repo for blocking computation
  const prStateMap = new Map<
    string,
    { hasPR: boolean; state: string | null }
  >();

  // Gather status for each repo
  const repoStatuses: RepoStatus[] = [];

  for (const repo of sortedRepos) {
    const { owner, repo: repoName } = parseRepoUrl(repo.url);

    // Find open PR for this feature branch
    const pr = await github.findPR({
      owner,
      repo: repoName,
      head: options.featureName,
      base: repo.defaultBranch,
    });

    if (!pr) {
      prStateMap.set(repo.name, { hasPR: false, state: null });
      repoStatuses.push({
        repoName: repo.name,
        prNumber: null,
        prUrl: null,
        ci: 'none',
        reviews: {
          approved: 0,
          changesRequested: 0,
          pending: 0,
          total: 0,
        },
        blocking: [],
      });
      continue;
    }

    // Get full PR status
    const prStatus = await github.getPRStatus({
      owner,
      repo: repoName,
      prNumber: pr.number,
    });

    prStateMap.set(repo.name, { hasPR: true, state: prStatus.state });

    const totalReviews =
      prStatus.reviews.approved +
      prStatus.reviews.changesRequested +
      prStatus.reviews.pending;

    repoStatuses.push({
      repoName: repo.name,
      prNumber: prStatus.number,
      prUrl: prStatus.url,
      ci: prStatus.ci,
      reviews: {
        approved: prStatus.reviews.approved,
        changesRequested: prStatus.reviews.changesRequested,
        pending: prStatus.reviews.pending,
        total: totalReviews,
      },
      blocking: [], // filled in below
    });
  }

  // Compute blocking relationships
  // A repo is blocked by its dependencies that have unmerged PRs
  for (const status of repoStatuses) {
    const deps = config.dependencies.filter((d) => d.from === status.repoName);
    for (const dep of deps) {
      if (!materializedSet.has(dep.to)) continue;
      const depState = prStateMap.get(dep.to);
      // If the dependency has a PR that is not merged, it blocks this repo
      if (depState && depState.hasPR && depState.state !== 'merged') {
        status.blocking.push(dep.to);
      }
      // If the dependency has no PR at all, it also blocks (nothing to merge)
      if (depState && !depState.hasPR) {
        status.blocking.push(dep.to);
      }
    }
  }

  // Determine mergeReady: all repos with PRs must have CI pass and at least one approval
  // and no changes requested
  const reposWithPRs = repoStatuses.filter((r) => r.prNumber !== null);
  const mergeReady =
    reposWithPRs.length > 0 &&
    reposWithPRs.every(
      (r) =>
        r.ci === 'pass' &&
        r.reviews.approved > 0 &&
        r.reviews.changesRequested === 0,
    );

  return {
    workspaceName: config.name,
    featureName: options.featureName,
    repos: repoStatuses,
    mergeReady,
  };
}
