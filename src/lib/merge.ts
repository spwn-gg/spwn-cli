import type { MergeResult, MergeStepResult, MergeHistoryEntry } from './types.js';
import { readConfig } from './workspace.js';
import { createGitHubAdapter, parseRepoUrl } from './github.js';
import type { GitHubAdapter } from './github.js';
import { topologicalSort } from './deps.js';
import { appendMergeEntry } from './history.js';

export interface MergeOptions {
  workspaceDir: string;
  featureName: string;
  githubToken: string;
  method?: 'merge' | 'squash' | 'rebase';
  dryRun?: boolean;
  pollDelayMs?: number;
  maxRetries?: number;
}

const DEFAULT_POLL_DELAY_MS = 10_000;
const DEFAULT_MAX_RETRIES = 30;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function merge(options: MergeOptions): Promise<MergeResult> {
  const {
    workspaceDir,
    featureName,
    githubToken,
    method = 'merge',
    dryRun = false,
    pollDelayMs = DEFAULT_POLL_DELAY_MS,
    maxRetries = DEFAULT_MAX_RETRIES,
  } = options;

  const config = await readConfig(workspaceDir);
  const feature = config.features.find((f) => f.name === featureName);
  if (!feature) {
    return {
      steps: [],
      allMerged: false,
      guidance: `Feature branch "${featureName}" not found in workspace config.`,
    };
  }

  const adapter: GitHubAdapter = createGitHubAdapter(githubToken);

  // Get topological order
  const sortResult = topologicalSort(config.repos, config.dependencies);
  if (sortResult.hasCycle) {
    return {
      steps: [],
      allMerged: false,
      guidance: `Dependency cycle detected: ${sortResult.cycle.join(' -> ')}. Cannot merge.`,
    };
  }

  // Filter to only repos materialized for this feature, in topological order
  const orderedRepos = sortResult.sorted.filter((r) =>
    feature.repos.includes(r.name),
  );

  const steps: MergeStepResult[] = [];

  for (const repo of orderedRepos) {
    const { owner, repo: repoName } = parseRepoUrl(repo.url);

    // Find PR for this feature branch
    const pr = await adapter.findPR({
      owner,
      repo: repoName,
      head: featureName,
      base: repo.defaultBranch,
    });

    if (!pr) {
      steps.push({
        repoName: repo.name,
        prNumber: 0,
        status: 'skipped',
        error: `No open PR found for branch "${featureName}" in ${repo.name}`,
      });
      continue;
    }

    // Poll CI status with retries
    let prStatus = await adapter.getPRStatus({
      owner,
      repo: repoName,
      prNumber: pr.number,
    });

    let retries = 0;
    while (
      (prStatus.ci === 'running' || prStatus.ci === 'pending') &&
      retries < maxRetries
    ) {
      if (pollDelayMs > 0) {
        await delay(pollDelayMs);
      }
      prStatus = await adapter.getPRStatus({
        owner,
        repo: repoName,
        prNumber: pr.number,
      });
      retries++;
    }

    // Check CI status
    if (prStatus.ci === 'fail') {
      steps.push({
        repoName: repo.name,
        prNumber: pr.number,
        status: 'failed',
        error: `CI checks failed for ${repo.name}`,
      });
      return {
        steps,
        allMerged: false,
        failedAt: repo.name,
        guidance: `CI checks failed on ${repo.name} (PR #${pr.number}). Fix CI before merging.`,
      };
    }

    if (prStatus.ci === 'running' || prStatus.ci === 'pending') {
      steps.push({
        repoName: repo.name,
        prNumber: pr.number,
        status: 'failed',
        error: `CI still running after ${maxRetries} retries for ${repo.name}`,
      });
      return {
        steps,
        allMerged: false,
        failedAt: repo.name,
        guidance: `CI checks still running on ${repo.name} (PR #${pr.number}) after ${maxRetries} retries. Try again later.`,
      };
    }

    // Dry run: record the plan without executing
    if (dryRun) {
      steps.push({
        repoName: repo.name,
        prNumber: pr.number,
        status: 'skipped',
      });
      continue;
    }

    // Merge the PR
    try {
      const mergeResult = await adapter.mergePR({
        owner,
        repo: repoName,
        prNumber: pr.number,
        method,
      });

      if (mergeResult.merged) {
        steps.push({
          repoName: repo.name,
          prNumber: pr.number,
          status: 'merged',
          mergeSha: mergeResult.sha,
        });
      } else {
        steps.push({
          repoName: repo.name,
          prNumber: pr.number,
          status: 'failed',
          error: `Merge was not successful for ${repo.name}`,
        });
        return {
          steps,
          allMerged: false,
          failedAt: repo.name,
          guidance: `Failed to merge PR #${pr.number} on ${repo.name}. Check for merge conflicts.`,
        };
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        repoName: repo.name,
        prNumber: pr.number,
        status: 'failed',
        error: message,
      });
      return {
        steps,
        allMerged: false,
        failedAt: repo.name,
        guidance: `Error merging PR #${pr.number} on ${repo.name}: ${message}`,
      };
    }
  }

  const allMerged = !dryRun && steps.every((s) => s.status === 'merged');

  // Record merge history
  if (allMerged) {
    const historyEntry: MergeHistoryEntry = {
      featureName,
      mergedAt: new Date().toISOString(),
      method,
      steps: steps
        .filter((s) => s.status === 'merged' && s.mergeSha)
        .map((s) => {
          const repo = orderedRepos.find((r) => r.name === s.repoName)!;
          const { owner, repo: repoName } = parseRepoUrl(repo.url);
          return {
            repoName: s.repoName,
            repoUrl: repo.url,
            prNumber: s.prNumber,
            prUrl: `https://github.com/${owner}/${repoName}/pull/${s.prNumber}`,
            mergeSha: s.mergeSha!,
          };
        }),
    };
    appendMergeEntry(workspaceDir, historyEntry);
  }

  return {
    steps,
    allMerged,
  };
}
