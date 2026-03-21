import type { MergeHistoryEntry } from './types.js';
import { createGitHubAdapter, parseRepoUrl } from './github.js';
import type { GitHubAdapter } from './github.js';
import { readHistory } from './history.js';

export interface RevertStepResult {
  repoName: string;
  prNumber: number;
  revertPrUrl: string | null;
  status: 'reverted' | 'failed' | 'skipped';
  error?: string;
}

export interface RevertResult {
  featureName: string;
  steps: RevertStepResult[];
  allReverted: boolean;
}

export async function revert(options: {
  workspaceDir: string;
  featureName: string;
  githubToken: string;
  dryRun?: boolean;
}): Promise<RevertResult> {
  const { workspaceDir, featureName, githubToken, dryRun = false } = options;

  const history = readHistory(workspaceDir);
  const entry = findLatestEntry(history.entries, featureName);

  if (!entry) {
    throw new Error(
      `No merge history found for feature "${featureName}". Available: ${history.entries.map((e) => e.featureName).join(', ') || 'none'}`,
    );
  }

  const adapter: GitHubAdapter = createGitHubAdapter(githubToken);
  const steps: RevertStepResult[] = [];

  // Revert in REVERSE dependency order (undo dependents first, then dependencies)
  const reversedSteps = [...entry.steps].reverse();

  for (const step of reversedSteps) {
    const { owner, repo: repoName } = parseRepoUrl(step.repoUrl);

    if (dryRun) {
      steps.push({
        repoName: step.repoName,
        prNumber: step.prNumber,
        revertPrUrl: null,
        status: 'skipped',
      });
      continue;
    }

    try {
      // Create a revert PR via GitHub API
      const revertPr = await adapter.createPR({
        owner,
        repo: repoName,
        head: `revert-${featureName}-${step.repoName}`,
        base: 'main', // Will be overridden below
        title: `Revert "${featureName}" in ${step.repoName}`,
        body: `Reverts merge commit ${step.mergeSha} from PR #${step.prNumber}.\n\nOriginal feature: ${featureName}\n\n_Created by [spwn revert](https://github.com/spwn-gg/spwn-cli)_`,
      });

      steps.push({
        repoName: step.repoName,
        prNumber: step.prNumber,
        revertPrUrl: revertPr.url,
        status: 'reverted',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      steps.push({
        repoName: step.repoName,
        prNumber: step.prNumber,
        revertPrUrl: null,
        status: 'failed',
        error: message,
      });
    }
  }

  const allReverted = !dryRun && steps.every((s) => s.status === 'reverted');

  return { featureName, steps, allReverted };
}

function findLatestEntry(
  entries: MergeHistoryEntry[],
  featureName: string,
): MergeHistoryEntry | undefined {
  // Find the most recent entry for this feature
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].featureName === featureName) {
      return entries[i];
    }
  }
  return undefined;
}
