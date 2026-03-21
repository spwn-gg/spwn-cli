import { Command, Args, Flags } from '@oclif/core';
import { checkout } from '../lib/branch.js';
import { configExists } from '../lib/workspace.js';

export default class Checkout extends Command {
  static override description =
    'Create and switch to a feature branch in a specific repository';

  static override examples = [
    '<%= config.bin %> checkout my-feature --repo backend',
    '<%= config.bin %> checkout my-feature --repo frontend --force',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name of the registered feature branch',
      required: true,
    }),
  };

  static override flags = {
    repo: Flags.string({
      description: 'Repository name to checkout the branch in',
      required: true,
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
    const featureName = args.feature;
    const repoName = flags.repo;
    const force = flags.force;

    if (!configExists(workspaceDir)) {
      this.error(
        `No workspace config found. Run "spwn init" first.`,
      );
    }

    try {
      const result = await checkout({
        workspaceDir,
        featureName,
        repoName,
        force,
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
