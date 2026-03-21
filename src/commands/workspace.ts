import { Command } from 'commander';
import { apiRequest } from '../utils/api-client.js';
import type { WorkspaceResponse, WorkspaceListResponse } from '@meridian/shared';

function printWorkspace(ws: WorkspaceResponse): void {
  console.log(`\nWorkspace: ${ws.name}`);
  console.log(`  ID:      ${ws.id}`);
  console.log(`  Version: ${ws.version}`);
  console.log(`  Created: ${ws.createdAt}`);
  console.log(`  Updated: ${ws.updatedAt}`);
  console.log(`  Repos (${ws.repos.length}):`);
  for (const repo of ws.repos) {
    console.log(`    - ${repo.url} (branch: ${repo.defaultBranch}, auth: ${repo.hasAuth ? 'yes' : 'no'})`);
    console.log(`      ID: ${repo.id}`);
  }
}

export function registerWorkspaceCommands(program: Command): void {
  const workspace = program.command('workspace').description('Manage workspaces');

  // create
  workspace
    .command('create <name>')
    .description('Create a new workspace')
    .option('--repo <url...>', 'Repository URLs to add')
    .option('--branch <branch>', 'Default branch for repos', 'main')
    .option('--token <token>', 'Auth token for private repos')
    .action(async (name: string, opts: { repo?: string[]; branch: string; token?: string }) => {
      if (!opts.repo || opts.repo.length === 0) {
        console.error('Error: At least one --repo is required');
        process.exit(1);
      }

      const repos = opts.repo.map((url) => ({
        url,
        defaultBranch: opts.branch,
        ...(opts.token ? { authToken: opts.token } : {}),
      }));

      const { data } = await apiRequest('POST', '/workspaces', { name, repos });
      printWorkspace(data as WorkspaceResponse);
    });

  // list
  workspace
    .command('list')
    .description('List all workspaces')
    .action(async () => {
      const { data } = await apiRequest('GET', '/workspaces');
      const response = data as WorkspaceListResponse;

      if (response.workspaces.length === 0) {
        console.log('No workspaces found.');
        return;
      }

      console.log('\nWorkspaces:');
      for (const ws of response.workspaces) {
        console.log(`  ${ws.name} (${ws.repoCount} repos) — ${ws.id}`);
      }
    });

  // show
  workspace
    .command('show <id>')
    .description('Show workspace details')
    .action(async (id: string) => {
      const { data } = await apiRequest('GET', `/workspaces/${id}`);
      printWorkspace(data as WorkspaceResponse);
    });

  // update
  workspace
    .command('update <id>')
    .description('Update workspace properties')
    .requiredOption('--name <name>', 'New workspace name')
    .action(async (id: string, opts: { name: string }) => {
      // First get current version
      const { data: current } = await apiRequest('GET', `/workspaces/${id}`);
      const ws = current as WorkspaceResponse;

      const { data } = await apiRequest('PATCH', `/workspaces/${id}`, {
        version: ws.version,
        name: opts.name,
      });
      printWorkspace(data as WorkspaceResponse);
    });

  // delete
  workspace
    .command('delete <id>')
    .description('Delete a workspace')
    .option('--force', 'Force deletion even with active intents')
    .action(async (id: string, opts: { force?: boolean }) => {
      const query = opts.force ? '?force=true' : '';
      await apiRequest('DELETE', `/workspaces/${id}${query}`);
      console.log('Workspace deleted.');
    });

  // add-repo
  workspace
    .command('add-repo <id>')
    .description('Add a repository to a workspace')
    .requiredOption('--url <url>', 'Repository URL')
    .option('--branch <branch>', 'Default branch', 'main')
    .option('--token <token>', 'Auth token')
    .action(async (id: string, opts: { url: string; branch: string; token?: string }) => {
      const { data: current } = await apiRequest('GET', `/workspaces/${id}`);
      const ws = current as WorkspaceResponse;

      const { data } = await apiRequest('POST', `/workspaces/${id}/repos`, {
        version: ws.version,
        url: opts.url,
        defaultBranch: opts.branch,
        ...(opts.token ? { authToken: opts.token } : {}),
      });
      printWorkspace(data as WorkspaceResponse);
    });

  // update-repo
  workspace
    .command('update-repo <id> <repoId>')
    .description('Update a repository reference')
    .option('--branch <branch>', 'New default branch')
    .option('--token <token>', 'New auth token')
    .action(async (id: string, repoId: string, opts: { branch?: string; token?: string }) => {
      const { data: current } = await apiRequest('GET', `/workspaces/${id}`);
      const ws = current as WorkspaceResponse;

      const body: Record<string, unknown> = { version: ws.version };
      if (opts.branch) body['defaultBranch'] = opts.branch;
      if (opts.token) body['authToken'] = opts.token;

      const { data } = await apiRequest('PATCH', `/workspaces/${id}/repos/${repoId}`, body);
      printWorkspace(data as WorkspaceResponse);
    });

  // remove-repo
  workspace
    .command('remove-repo <id> <repoId>')
    .description('Remove a repository from a workspace')
    .action(async (id: string, repoId: string) => {
      const { data: current } = await apiRequest('GET', `/workspaces/${id}`);
      const ws = current as WorkspaceResponse;

      const { data } = await apiRequest('DELETE', `/workspaces/${id}/repos/${repoId}`, {
        version: ws.version,
      });
      printWorkspace(data as WorkspaceResponse);
    });
}
