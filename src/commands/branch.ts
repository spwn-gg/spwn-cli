import { Command, Args, Flags } from '@oclif/core';
import { registerBranch } from '../lib/branch.js';
import { configExists, readConfig } from '../lib/workspace.js';

export default class Branch extends Command {
  static override description =
    'Register a new feature branch, or list features if no name given';

  static override examples = [
    '<%= config.bin %> branch my-feature',
    '<%= config.bin %> branch',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name for the feature branch (alphanumeric and hyphens)',
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
    const { args, flags } = await this.parse(Branch);
    const workspaceDir = flags.dir;

    if (!configExists(workspaceDir)) {
      this.error('No workspace config found. Run "spwn init" first.');
    }

    // No feature provided — list existing features
    if (!args.feature) {
      const config = await readConfig(workspaceDir);
      if (config.features.length === 0) {
        this.log('No features registered. Usage: spwn branch <name>');
        return;
      }

      this.log('Registered features:\n');
      for (const f of config.features) {
        const repoCount = f.repos.length;
        const repos = repoCount > 0 ? f.repos.join(', ') : 'none';
        this.log(`  ${f.name}  (${repoCount} repo${repoCount !== 1 ? 's' : ''}: ${repos})`);
      }

      this.log('\nTo register a new feature: spwn branch <name>');
      return;
    }

    try {
      const feature = await registerBranch({ workspaceDir, featureName: args.feature });
      this.log(
        `Feature "${feature.name}" registered at ${feature.createdAt}.`,
      );
    } catch (error) {
      if (error instanceof Error) {
        this.error(error.message);
      }
      throw error;
    }
  }
}
