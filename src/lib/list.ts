import { readConfig } from './workspace.js';

export interface FeatureInfo {
  name: string;
  createdAt: string;
  materializedRepos: string[];
  repoCount: number;
}

export interface RepoInfo {
  name: string;
  path: string;
  packageName: string;
  defaultBranch: string;
  dependsOn: string[];
  dependedBy: string[];
}

export async function listFeatures(options: { workspaceDir: string }): Promise<FeatureInfo[]> {
  const config = await readConfig(options.workspaceDir);

  return config.features.map((feature) => ({
    name: feature.name,
    createdAt: feature.createdAt,
    materializedRepos: [...feature.repos],
    repoCount: feature.repos.length,
  }));
}

export async function listRepos(options: { workspaceDir: string }): Promise<RepoInfo[]> {
  const config = await readConfig(options.workspaceDir);

  return config.repos.map((repo) => {
    const dependsOn = config.dependencies
      .filter((dep) => dep.from === repo.name)
      .map((dep) => dep.to);

    const dependedBy = config.dependencies
      .filter((dep) => dep.to === repo.name)
      .map((dep) => dep.from);

    return {
      name: repo.name,
      path: repo.path,
      packageName: repo.packageName,
      defaultBranch: repo.defaultBranch,
      dependsOn,
      dependedBy,
    };
  });
}
