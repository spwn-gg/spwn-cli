import { Command, Flags } from '@oclif/core';
import { listRepos } from '../../lib/list.js';

export default class ListRepos extends Command {
  static override description = 'List all repos in the workspace with their dependency info';

  static override examples = [
    '<%= config.bin %> list repos',
    '<%= config.bin %> list repos --json',
    '<%= config.bin %> list repos --dir /path/to/workspace',
  ];

  static override flags = {
    json: Flags.boolean({
      description: 'Output as JSON',
      default: false,
    }),
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { flags } = await this.parse(ListRepos);

    try {
      const repos = await listRepos({ workspaceDir: flags.dir });

      if (flags.json) {
        this.log(JSON.stringify(repos, null, 2));
        return;
      }

      if (repos.length === 0) {
        this.log('\nNo repos found in this workspace.');
        return;
      }

      const fmt = (arr: string[]) => (arr.length === 0 ? '—' : arr.join(', '));

      // Calculate column widths
      const nameWidth = Math.max(4, ...repos.map((r) => r.name.length));
      const pkgWidth = Math.max(7, ...repos.map((r) => r.packageName.length));
      const depsOnWidth = Math.max(10, ...repos.map((r) => fmt(r.dependsOn).length));
      const depsByWidth = Math.max(11, ...repos.map((r) => fmt(r.dependedBy).length));

      const header = `  ${'Name'.padEnd(nameWidth)}  ${'Package'.padEnd(pkgWidth)}  ${'Depends On'.padEnd(depsOnWidth)}  ${'Depended By'.padEnd(depsByWidth)}`;
      const separator = `  ${'─'.repeat(nameWidth)}  ${'─'.repeat(pkgWidth)}  ${'─'.repeat(depsOnWidth)}  ${'─'.repeat(depsByWidth)}`;

      this.log('');
      this.log(header);
      this.log(separator);

      for (const repo of repos) {
        this.log(
          `  ${repo.name.padEnd(nameWidth)}  ${repo.packageName.padEnd(pkgWidth)}  ${fmt(repo.dependsOn).padEnd(depsOnWidth)}  ${fmt(repo.dependedBy).padEnd(depsByWidth)}`,
        );
      }

      this.log('');
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
