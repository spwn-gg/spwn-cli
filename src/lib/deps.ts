import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  RepoConfig,
  DependencyEdge,
  TopologicalSortResult,
  ManifestType,
} from './types.js';

interface ManifestInfo {
  packageName: string;
  manifestType: ManifestType;
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
}

function readManifest(repoPath: string): ManifestInfo | null {
  const pkgPath = join(repoPath, 'package.json');
  if (existsSync(pkgPath)) {
    try {
      const raw = JSON.parse(readFileSync(pkgPath, 'utf-8'));
      return {
        packageName: raw.name ?? '',
        manifestType: 'package.json',
        dependencies: raw.dependencies ?? {},
        devDependencies: raw.devDependencies ?? {},
        peerDependencies: raw.peerDependencies ?? {},
      };
    } catch {
      return null;
    }
  }
  // TODO: support go.mod, Cargo.toml, pyproject.toml in future
  return null;
}

export function scanManifests(
  repos: RepoConfig[],
): Map<string, ManifestInfo> {
  const manifests = new Map<string, ManifestInfo>();
  for (const repo of repos) {
    const manifest = readManifest(repo.path);
    if (manifest) {
      manifests.set(repo.name, manifest);
    }
  }
  return manifests;
}

export function detectDependencies(repos: RepoConfig[]): DependencyEdge[] {
  const manifests = scanManifests(repos);
  const edges: DependencyEdge[] = [];

  // Build a map from package name to repo name
  const packageToRepo = new Map<string, string>();
  for (const repo of repos) {
    const manifest = manifests.get(repo.name);
    if (manifest) {
      packageToRepo.set(manifest.packageName, repo.name);
    }
  }

  for (const repo of repos) {
    const manifest = manifests.get(repo.name);
    if (!manifest) continue;

    const checkDeps = (
      deps: Record<string, string>,
      type: DependencyEdge['type'],
    ) => {
      for (const [depName, depVersion] of Object.entries(deps)) {
        // Check if dep name matches a repo's package name
        const targetRepo = packageToRepo.get(depName);
        if (targetRepo && targetRepo !== repo.name) {
          edges.push({
            from: repo.name,
            to: targetRepo,
            type,
            packageName: depName,
          });
          continue;
        }

        // Check if it's a file:../ reference
        if (typeof depVersion === 'string' && depVersion.startsWith('file:')) {
          const relPath = depVersion.replace('file:', '');
          // Try to match to a repo by checking if any repo's path ends with the referenced dir
          for (const otherRepo of repos) {
            if (otherRepo.name === repo.name) continue;
            if (
              relPath.includes(otherRepo.name) ||
              otherRepo.path.endsWith(relPath.replace('../', '').replace('./', ''))
            ) {
              edges.push({
                from: repo.name,
                to: otherRepo.name,
                type,
                packageName: depName,
              });
              break;
            }
          }
        }
      }
    };

    checkDeps(manifest.dependencies, 'runtime');
    checkDeps(manifest.devDependencies, 'dev');
    checkDeps(manifest.peerDependencies, 'peer');
  }

  return edges;
}

// Kahn's algorithm for topological sort with cycle detection
export function topologicalSort(
  repos: RepoConfig[],
  dependencies: DependencyEdge[],
): TopologicalSortResult {
  const nodeMap = new Map(repos.map((r) => [r.name, r]));
  const inDegree = new Map<string, number>();
  const dependents = new Map<string, string[]>(); // dependency -> [dependents]

  // Initialize
  for (const repo of repos) {
    inDegree.set(repo.name, 0);
    dependents.set(repo.name, []);
  }

  // Build graph: edges go from dependency TO dependent
  // "from" depends on "to", so "to" must come first
  for (const edge of dependencies) {
    if (!nodeMap.has(edge.from) || !nodeMap.has(edge.to)) continue;
    dependents.get(edge.to)!.push(edge.from);
    inDegree.set(edge.from, (inDegree.get(edge.from) ?? 0) + 1);
  }

  // Find nodes with no incoming edges (leaves/roots of dependency tree)
  const queue: string[] = [];
  for (const [name, degree] of inDegree) {
    if (degree === 0) queue.push(name);
  }

  const sorted: RepoConfig[] = [];
  while (queue.length > 0) {
    const name = queue.shift()!;
    sorted.push(nodeMap.get(name)!);

    for (const dependent of dependents.get(name) ?? []) {
      const newDegree = (inDegree.get(dependent) ?? 1) - 1;
      inDegree.set(dependent, newDegree);
      if (newDegree === 0) {
        queue.push(dependent);
      }
    }
  }

  if (sorted.length !== repos.length) {
    // Cycle detected — remaining nodes are in the cycle
    const sortedNames = new Set(sorted.map((r) => r.name));
    const cycle = repos
      .filter((r) => !sortedNames.has(r.name))
      .map((r) => r.name);
    return { sorted, hasCycle: true, cycle };
  }

  return { sorted, hasCycle: false, cycle: [] };
}
