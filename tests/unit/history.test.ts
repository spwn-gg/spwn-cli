import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { readHistory, writeHistory, appendMergeEntry } from '../../src/lib/history.js';
import type { MergeHistoryEntry } from '../../src/lib/types.js';

function makeTmpDir(): string {
  return fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'spwn-history-test-')));
}

function makeEntry(name: string): MergeHistoryEntry {
  return {
    featureName: name,
    mergedAt: new Date().toISOString(),
    method: 'merge',
    steps: [
      {
        repoName: 'repo-a',
        repoUrl: 'git@github.com:test/repo-a.git',
        prNumber: 1,
        prUrl: 'https://github.com/test/repo-a/pull/1',
        mergeSha: 'abc123',
      },
    ],
  };
}

describe('merge history', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = makeTmpDir();
    fs.mkdirSync(path.join(tmpDir, '.spwn'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('returns empty history when no file exists', () => {
    const history = readHistory(tmpDir);
    expect(history.version).toBe(1);
    expect(history.entries).toEqual([]);
  });

  it('writes and reads history', () => {
    const entry = makeEntry('feat-1');
    writeHistory(tmpDir, { version: 1, entries: [entry] });

    const history = readHistory(tmpDir);
    expect(history.entries).toHaveLength(1);
    expect(history.entries[0].featureName).toBe('feat-1');
    expect(history.entries[0].steps[0].mergeSha).toBe('abc123');
  });

  it('appends entries', () => {
    appendMergeEntry(tmpDir, makeEntry('feat-1'));
    appendMergeEntry(tmpDir, makeEntry('feat-2'));

    const history = readHistory(tmpDir);
    expect(history.entries).toHaveLength(2);
    expect(history.entries[0].featureName).toBe('feat-1');
    expect(history.entries[1].featureName).toBe('feat-2');
  });

  it('preserves full step data through round-trip', () => {
    const entry = makeEntry('feat-1');
    appendMergeEntry(tmpDir, entry);

    const history = readHistory(tmpDir);
    const step = history.entries[0].steps[0];
    expect(step.repoName).toBe('repo-a');
    expect(step.repoUrl).toBe('git@github.com:test/repo-a.git');
    expect(step.prNumber).toBe(1);
    expect(step.prUrl).toBe('https://github.com/test/repo-a/pull/1');
    expect(step.mergeSha).toBe('abc123');
  });
});
