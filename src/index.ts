import { Command } from 'commander';
import { registerWorkspaceCommands } from './commands/workspace.js';
import { registerIntentCommands } from './commands/intent.js';
import { registerChangesetCommands } from './commands/changeset.js';
import { registerMergeCommands } from './commands/merge.js';
import { registerGitProviderCommands } from './commands/git-provider.js';
import { registerPushCommands } from './commands/push.js';

const program = new Command();

program
  .name('meridian')
  .description('Cross-repository pull requests for the AI era')
  .version('0.1.0');

registerWorkspaceCommands(program);
registerIntentCommands(program);
registerChangesetCommands(program);
registerMergeCommands(program);
registerGitProviderCommands(program);
registerPushCommands(program);

program.parseAsync().catch((err: Error) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
