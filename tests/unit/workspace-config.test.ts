import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readConfig, writeConfig, configExists } from '../../src/lib/workspace.js';
import type { WorkspaceConfig } from '../../src/lib/types.js';

function makeSampleConfig(overrides?: Partial<WorkspaceConfig>): WorkspaceConfig {
  return {
    version: 1,
    name: 'test-workspace',
    repos: [
      {
        name: 'backend',
        path: 'packages/backend',
        url: 'https://github.com/org/backend.git',
        defaultBranch: 'main',
        packageName: '@org/backend',
        manifestType: 'package.json',
      },
    ],
    dependencies: [
      {
        from: 'frontend',
        to: 'backend',
        type: 'runtime',
        packageName: '@org/backend',
      },
    ],
    features: [
      {
        name: 'feat/login',
        createdAt: '2026-01-15T10:00:00.000Z',
        repos: ['backend', 'frontend'],
      },
    ],
    lastUpdated: '2026-03-21T00:00:00.000Z',
    ...overrides,
  };
}

describe('workspace config persistence', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writeConfig creates .spwn directory and writes workspace.json', async () => {
    const config = makeSampleConfig();
    await writeConfig(tmpDir, config);

    const spwnDir = path.join(tmpDir, '.spwn');
    const configPath = path.join(spwnDir, 'workspace.json');

    expect(fs.existsSync(spwnDir)).toBe(true);
    expect(fs.statSync(spwnDir).isDirectory()).toBe(true);
    expect(fs.existsSync(configPath)).toBe(true);

    const raw = fs.readFileSync(configPath, 'utf-8');
    const parsed = JSON.parse(raw);
    expect(parsed.name).toBe('test-workspace');
    expect(parsed.version).toBe(1);
  });

  it('readConfig reads back the correct data', async () => {
    const config = makeSampleConfig();
    await writeConfig(tmpDir, config);

    const loaded = await readConfig(tmpDir);
    expect(loaded.name).toBe('test-workspace');
    expect(loaded.version).toBe(1);
    expect(loaded.repos).toHaveLength(1);
    expect(loaded.repos[0].name).toBe('backend');
    expect(loaded.dependencies).toHaveLength(1);
    expect(loaded.features).toHaveLength(1);
    expect(loaded.lastUpdated).toBe('2026-03-21T00:00:00.000Z');
  });

  it('configExists returns true when config exists', async () => {
    const config = makeSampleConfig();
    await writeConfig(tmpDir, config);

    expect(configExists(tmpDir)).toBe(true);
  });

  it('configExists returns false when no config', () => {
    expect(configExists(tmpDir)).toBe(false);
  });

  it('readConfig throws when config does not exist', async () => {
    await expect(readConfig(tmpDir)).rejects.toThrow();
  });

  it('writeConfig overwrites existing config', async () => {
    const original = makeSampleConfig({ name: 'original' });
    await writeConfig(tmpDir, original);

    const updated = makeSampleConfig({ name: 'updated' });
    await writeConfig(tmpDir, updated);

    const loaded = await readConfig(tmpDir);
    expect(loaded.name).toBe('updated');
  });

  it('config round-trips correctly (write then read matches)', async () => {
    const config = makeSampleConfig();
    await writeConfig(tmpDir, config);
    const loaded = await readConfig(tmpDir);

    expect(loaded).toEqual(config);
  });
});
