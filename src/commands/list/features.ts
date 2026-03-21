import { Command, Flags } from '@oclif/core';
import { listFeatures } from '../../lib/list.js';

export default class ListFeatures extends Command {
  static override description = 'List all registered features with their materialized repo count';

  static override examples = [
    '<%= config.bin %> list features',
    '<%= config.bin %> list features --json',
    '<%= config.bin %> list features --dir /path/to/workspace',
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
    const { flags } = await this.parse(ListFeatures);

    try {
      const features = await listFeatures({ workspaceDir: flags.dir });

      if (flags.json) {
        this.log(JSON.stringify(features, null, 2));
        return;
      }

      if (features.length === 0) {
        this.log('\nNo features registered in this workspace.');
        return;
      }

      // Read config to get total repo count
      const { readConfig } = await import('../../lib/workspace.js');
      const config = await readConfig(flags.dir);
      const totalRepos = config.repos.length;

      // Calculate column widths
      const nameWidth = Math.max(4, ...features.map((f) => f.name.length));
      const reposWidth = Math.max(5, ...features.map((f) => `${f.repoCount}/${totalRepos}`.length));
      const createdWidth = Math.max(7, ...features.map((f) => f.createdAt.slice(0, 10).length));

      const header = `  ${'Name'.padEnd(nameWidth)}  ${'Repos'.padEnd(reposWidth)}  ${'Created'.padEnd(createdWidth)}`;
      const separator = `  ${'─'.repeat(nameWidth)}  ${'─'.repeat(reposWidth)}  ${'─'.repeat(createdWidth)}`;

      this.log('');
      this.log(header);
      this.log(separator);

      for (const feature of features) {
        const repos = `${feature.repoCount}/${totalRepos}`;
        const created = feature.createdAt.slice(0, 10);
        this.log(`  ${feature.name.padEnd(nameWidth)}  ${repos.padEnd(reposWidth)}  ${created.padEnd(createdWidth)}`);
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
