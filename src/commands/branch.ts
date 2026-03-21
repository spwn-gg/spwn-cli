import { Command, Args, Flags } from '@oclif/core';
import { registerBranch } from '../lib/branch.js';
import { configExists } from '../lib/workspace.js';

export default class Branch extends Command {
  static override description =
    'Register a new feature branch in the workspace';

  static override examples = [
    '<%= config.bin %> branch my-feature',
    '<%= config.bin %> branch add-login --dir /path/to/workspace',
  ];

  static override args = {
    feature: Args.string({
      description: 'Name for the feature branch (alphanumeric and hyphens)',
      required: true,
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
    const featureName = args.feature;

    if (!configExists(workspaceDir)) {
      this.error(
        `No workspace config found. Run "spwn init" first.`,
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
