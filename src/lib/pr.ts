import { join } from 'node:path';
import type { PRCreateResult, RepoConfig } from './types.js';
import { readConfig } from './workspace.js';
import { createGitHubAdapter, parseRepoUrl } from './github.js';
import { getCommitsAhead } from './git.js';
import { topologicalSort } from './deps.js';

export interface GeneratePRBodyOptions {
  title: string;
  body: string;
  currentRepo: string;
  prMap: Map<string, { url: string; number: number }>;
  dependencyOrder: string[];
}

export function generatePRBody(options: GeneratePRBodyOptions): string {
  const { body, currentRepo, prMap, dependencyOrder } = options;

  const lines: string[] = [];

  lines.push(body);
  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('### Coordinated PRs');
  lines.push('');
  lines.push('This PR is part of a multi-repo change:');
  lines.push('');
  lines.push('| Repo | PR | Status |');
  lines.push('|------|-----|--------|');

  for (const repoName of dependencyOrder) {
    const pr = prMap.get(repoName);
    if (!pr) continue;

    if (repoName === currentRepo) {
      lines.push(`| ${repoName} | #${pr.number} | <- this PR |`);
    } else {
      lines.push(`| ${repoName} | [#${pr.number}](${pr.url}) | pending |`);
    }
  }

  lines.push('');
  lines.push('### Dependency Order');
  lines.push('');
  lines.push(
    '`' + dependencyOrder.join('` -> `') + '`',
  );
  lines.push('');
  lines.push('_Created by [spwn](https://github.com/bartam/meridian)_');

  return lines.join('\n');
}

export async function createPRs(options: {
  workspaceDir: string;
  featureName: string;
  title: string;
  body: string;
  draft?: boolean;
}): Promise<PRCreateResult[]> {
  const { workspaceDir, featureName, title, body, draft } = options;

  // Get GitHub token
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!token) {
    throw new Error(
      'GitHub token not found. Set GH_TOKEN or GITHUB_TOKEN environment variable.',
    );
  }

  // Read workspace config
  const config = await readConfig(workspaceDir);

  // Find the feature branch
  const feature = config.features.find((f) => f.name === featureName);
  if (!feature) {
    throw new Error(
      `Feature branch '${featureName}' not found in workspace config.`,
    );
  }

  // Get topological sort for dependency order
  const sortResult = topologicalSort(config.repos, config.dependencies);
  const sortedRepos = sortResult.sorted;
  const dependencyOrder = sortedRepos.map((r) => r.name);

  // Filter to only materialized repos
  const materializedRepos = sortedRepos.filter((r) =>
    feature.repos.includes(r.name),
  );

  // Check commits ahead for each materialized repo
  const reposWithChanges: Array<{ repo: RepoConfig; commitsAhead: number }> =
    [];
  const skippedResults: PRCreateResult[] = [];

  for (const repo of materializedRepos) {
    const repoPath = join(workspaceDir, repo.path);
    const ahead = getCommitsAhead(repoPath, repo.defaultBranch, featureName);

    if (ahead === 0) {
      skippedResults.push({
        repoName: repo.name,
        prUrl: '',
        prNumber: 0,
        skipped: true,
        skipReason: `${repo.name} has no commits ahead of ${repo.defaultBranch}`,
      });
    } else {
      reposWithChanges.push({ repo, commitsAhead: ahead });
    }
  }

  if (reposWithChanges.length === 0) {
    return skippedResults;
  }

  // Create GitHub adapter
  const gh = createGitHubAdapter(token);

  // First pass: create PRs and collect results
  const prMap = new Map<string, { url: string; number: number }>();
  const results: PRCreateResult[] = [];

  for (const { repo } of reposWithChanges) {
    const { owner, repo: repoName } = parseRepoUrl(repo.url);

    // Build initial PR body (without cross-references since we don't have all PR numbers yet)
    const initialBody = generatePRBody({
      title,
      body,
      currentRepo: repo.name,
      prMap,
      dependencyOrder: reposWithChanges.map((r) => r.repo.name),
    });

    const pr = await gh.createPR({
      owner,
      repo: repoName,
      head: featureName,
      base: repo.defaultBranch,
      title,
      body: initialBody,
      draft,
    });

    prMap.set(repo.name, { url: pr.url, number: pr.number });

    results.push({
      repoName: repo.name,
      prUrl: pr.url,
      prNumber: pr.number,
      skipped: false,
    });
  }

  // Add skipped results
  results.push(...skippedResults);

  // Sort results by dependency order
  results.sort((a, b) => {
    const aIdx = dependencyOrder.indexOf(a.repoName);
    const bIdx = dependencyOrder.indexOf(b.repoName);
    return aIdx - bIdx;
  });

  return results;
}
