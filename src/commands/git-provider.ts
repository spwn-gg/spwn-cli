import { Command } from 'commander';
import { apiRequest } from '../utils/api-client.js';
import type { GitProviderConfigResponse, ValidateProviderResponse } from '@meridian/shared';

function providerPath(workspaceId: string): string {
  return `/workspaces/${workspaceId}/git-provider`;
}

export function registerGitProviderCommands(program: Command): void {
  const gitProvider = program
    .command('git-provider')
    .description('Manage git provider configuration');

  // set
  gitProvider
    .command('set <workspaceId>')
    .description('Set git provider for a workspace')
    .requiredOption('--type <type>', 'Provider type (github, gitea)')
    .option('--base-url <url>', 'Provider base URL')
    .action(
      async (workspaceId: string, opts: { type: string; baseUrl?: string }) => {
        const { status, data } = await apiRequest(
          'PUT',
          providerPath(workspaceId),
          { providerType: opts.type, baseUrl: opts.baseUrl },
        );
        const config = data as GitProviderConfigResponse;
        const action = status === 201 ? 'Created' : 'Updated';
        console.log(`\n${action} git provider config:`);
        console.log(`  Provider: ${config.providerType}`);
        console.log(`  Base URL: ${config.baseUrl ?? '(default)'}`);
      },
    );

  // show
  gitProvider
    .command('show <workspaceId>')
    .description('Show git provider configuration')
    .action(async (workspaceId: string) => {
      const { data } = await apiRequest('GET', providerPath(workspaceId));
      const config = data as GitProviderConfigResponse;
      console.log(`\nGit Provider Config:`);
      console.log(`  ID:       ${config.id}`);
      console.log(`  Provider: ${config.providerType}`);
      console.log(`  Base URL: ${config.baseUrl ?? '(default)'}`);
      console.log(`  Created:  ${config.createdAt}`);
      console.log(`  Updated:  ${config.updatedAt}`);
    });

  // remove
  gitProvider
    .command('remove <workspaceId>')
    .description('Remove git provider configuration')
    .action(async (workspaceId: string) => {
      await apiRequest('DELETE', providerPath(workspaceId));
      console.log('Git provider configuration removed.');
    });

  // validate
  gitProvider
    .command('validate <workspaceId>')
    .description('Validate git provider credentials and connectivity')
    .action(async (workspaceId: string) => {
      const { data } = await apiRequest(
        'POST',
        `${providerPath(workspaceId)}/validate`,
      );
      const result = data as ValidateProviderResponse;

      console.log(
        `\nProvider: ${result.providerType} (${result.baseUrl ?? 'default'})\n`,
      );

      for (const repo of result.results) {
        console.log(`  ${repo.repoUrl}`);
        if (repo.valid) {
          console.log(`    Status: valid`);
          console.log(`    User: ${repo.authenticatedUser}`);
        } else {
          console.log(`    Status: invalid`);
          console.log(`    Error: ${repo.error}`);
        }
        console.log();
      }
    });
}
