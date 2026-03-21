import { join } from 'node:path';
import { readConfig } from './workspace.js';
import { getCurrentBranch } from './git.js';

/**
 * Detect the feature branch name, either from an explicit flag or by
 * scanning workspace repos for a branch that matches a registered feature.
 */
export async function detectFeature(options: {
  workspaceDir: string;
  explicit?: string;
}): Promise<string> {
  const { workspaceDir, explicit } = options;
  const config = await readConfig(workspaceDir);
  const featureNames = config.features.map((f) => f.name);

  if (featureNames.length === 0) {
    throw new Error(
      'No features registered in this workspace. Register one first with: spwn branch register <name>',
    );
  }

  // If explicitly provided, validate it exists and return it
  if (explicit) {
    if (!featureNames.includes(explicit)) {
      throw new Error(
        `Feature '${explicit}' is not registered. Available features: ${featureNames.join(', ')}`,
      );
    }
    return explicit;
  }

  // Auto-detect: scan repos for current branch names that match a feature
  for (const repo of config.repos) {
    const repoPath = join(workspaceDir, repo.path);
    const branch = getCurrentBranch(repoPath);
    if (branch && featureNames.includes(branch)) {
      return branch;
    }
  }

  throw new Error(
    `Could not auto-detect feature from current branch. No repo is on a branch matching a registered feature.\nAvailable features: ${featureNames.join(', ')}\nTip: pass --feature explicitly or checkout a feature branch first.`,
  );
}
