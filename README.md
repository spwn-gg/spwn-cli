<p align="center">
  <img src="assets/spwn-logo-dark.svg" alt="spwn" width="320" />
</p>

# spwn-cli

Multi-repo workspace orchestration CLI. Register feature branches, create coordinated PRs, and merge in dependency order across repositories.

## Install

```bash
npm install -g spwn-cli
```

## Commands

```bash
spwn init --name <workspace>     # Scan repos, detect dependencies
spwn branch <feature>            # Register a feature branch
spwn checkout <feature> --repo <name>  # Create branch in a repo
spwn switch <feature>            # Switch all repos to feature branch
spwn pr create --feature <name>  # Create linked PRs across repos
spwn status --feature <name>     # View PR status in dependency order
spwn merge --feature <name>      # Merge PRs in topological order
spwn revert --feature <name>     # Revert a merged feature
spwn list repos                  # List workspace repos
spwn list features               # List registered features
```

## Development

```bash
npm install
npm run build
npm link
```

## Project Structure

```
src/
  commands/             # oclif command implementations
  lib/
    workspace.ts        # config read/write
    git.ts              # git operations
    deps.ts             # dependency detection
    github.ts           # GitHub API
    pr.ts               # PR creation and linking
    merge.ts            # merge orchestration
    types.ts            # CLI types
```
