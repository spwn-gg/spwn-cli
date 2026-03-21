import { Command, Args } from '@oclif/core';
import { registerBranch } from '../lib/branch.js';
import { configExists } from '../lib/workspace.js';

export default class Branch extends Command {
  static override description =
    'Register a new feature branch in the workspace';

  static override examples = [
    '<%= config.bin %> branch . my-feature',
    '<%= config.bin %> branch /path/to/workspace add-login',
  ];

  static override args = {
    workspace: Args.string({
      description: 'Path to the workspace root',
      required: true,
    }),
    'feature-name': Args.string({
      description: 'Name for the feature branch (alphanumeric and hyphens)',
      required: true,
    }),
  };

  async run(): Promise<void> {
    const { args } = await this.parse(Branch);
    const workspaceDir = args['workspace'];
    const featureName = args['feature-name'];

    if (!configExists(workspaceDir)) {
      this.error(
        `No workspace config found at ${workspaceDir}. Run "spwn init" first.`,
      );
    }

    try {
      const feature = await registerBranch({ workspaceDir, featureName });
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
