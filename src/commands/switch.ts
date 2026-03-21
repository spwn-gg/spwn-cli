import { Command, Args, Flags } from '@oclif/core';
import { switchFeature } from '../lib/branch.js';
import { configExists, readConfig } from '../lib/workspace.js';

export default class Switch extends Command {
  static override description =
    'Switch to a feature branch across all materialized repos';

  static override examples = [
    '<%= config.bin %> switch my-feature',
    '<%= config.bin %> switch',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name of the registered feature branch',
      required: false,
    }),
  };

  static override flags = {
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Switch);
    const workspaceDir = flags.dir;

    if (!configExists(workspaceDir)) {
      this.error('No workspace config found. Run "spwn init" first.');
    }

    // If no feature provided, list available features
    if (!args.feature) {
      const config = await readConfig(workspaceDir);
      if (config.features.length === 0) {
        this.log('No features registered. Run "spwn branch <name>" to register one.');
        return;
      }

      this.log('Available features:\n');
      for (const f of config.features) {
        const repoCount = f.repos.length;
        const repos = repoCount > 0 ? f.repos.join(', ') : 'none';
        this.log(`  ${f.name}  (${repoCount} repo${repoCount !== 1 ? 's' : ''}: ${repos})`);
      }

      this.log('\nUsage: spwn switch <feature>');
      return;
    }

    try {
      const result = await switchFeature({
        workspaceDir,
        featureName: args.feature,
      });

      for (const repoName of result.switched) {
        this.log(`Switched "${repoName}" to branch "${args.feature}".`);
      }

      for (const { repoName, reason } of result.skipped) {
        this.warn(`Skipped "${repoName}": ${reason}`);
      }

      if (result.switched.length === 0) {
        this.warn('No repos were switched.');
      } else {
        this.log(
          `Switched ${result.switched.length} repo(s) to "${args.feature}".`,
        );
      }
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
