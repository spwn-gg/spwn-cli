import { Command, Args, Flags } from '@oclif/core';
import { checkout } from '../lib/branch.js';
import { configExists, readConfig } from '../lib/workspace.js';

export default class Checkout extends Command {
  static override description =
    'Create and switch to a feature branch in a specific repository';

  static override examples = [
    '<%= config.bin %> checkout my-feature --repo backend',
    '<%= config.bin %> checkout my-feature',
    '<%= config.bin %> checkout',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name of the registered feature branch',
      required: false,
    }),
  };

  static override flags = {
    repo: Flags.string({
      description: 'Repository name to checkout the branch in',
      required: false,
    }),
    force: Flags.boolean({
      description: 'Force checkout even if the repository has uncommitted changes',
      default: false,
    }),
    dir: Flags.string({
      description: 'Workspace root directory',
      default: '.',
    }),
  };

  async run(): Promise<void> {
    const { args, flags } = await this.parse(Checkout);
    const workspaceDir = flags.dir;

    if (!configExists(workspaceDir)) {
      this.error('No workspace config found. Run "spwn init" first.');
    }

    const config = await readConfig(workspaceDir);

    // No feature provided — list features
    if (!args.feature) {
      if (config.features.length === 0) {
        this.log('No features registered. Run "spwn branch <name>" first.');
        return;
      }

      this.log('Available features:\n');
      for (const f of config.features) {
        const repoCount = f.repos.length;
        const repos = repoCount > 0 ? f.repos.join(', ') : 'none';
        this.log(`  ${f.name}  (${repoCount} repo${repoCount !== 1 ? 's' : ''}: ${repos})`);
      }

      this.log('\nUsage: spwn checkout <feature> --repo <name>');
      return;
    }

    // Feature provided but no --repo — list available repos
    if (!flags.repo) {
      this.log(`Repos in workspace "${config.name}":\n`);
      const feature = config.features.find((f) => f.name === args.feature);
      for (const repo of config.repos) {
        const materialized = feature?.repos.includes(repo.name);
        const marker = materialized ? ' (checked out)' : '';
        this.log(`  ${repo.name}${marker}`);
      }

      this.log(`\nUsage: spwn checkout ${args.feature} --repo <name>`);
      return;
    }

    try {
      const result = await checkout({
        workspaceDir,
        featureName: args.feature,
        repoName: flags.repo,
        force: flags.force,
      });

      if (result.created) {
        this.log(
          `Created and switched to branch "${result.branchName}" in ${result.repoName}.`,
        );
      } else {
        this.log(
          `Switched to existing branch "${result.branchName}" in ${result.repoName}.`,
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
