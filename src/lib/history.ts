import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type { MergeHistory, MergeHistoryEntry } from './types.js';

const CONFIG_DIR = '.spwn';
const HISTORY_FILE = 'history.json';

function historyPath(dir: string): string {
  return join(dir, CONFIG_DIR, HISTORY_FILE);
}

export function readHistory(dir: string): MergeHistory {
  const path = historyPath(dir);
  if (!existsSync(path)) {
    return { version: 1, entries: [] };
  }
  const content = readFileSync(path, 'utf-8');
  return JSON.parse(content) as MergeHistory;
}

export function writeHistory(dir: string, history: MergeHistory): void {
  const dirPath = join(dir, CONFIG_DIR);
  mkdirSync(dirPath, { recursive: true });
  writeFileSync(historyPath(dir), JSON.stringify(history, null, 2), 'utf-8');
}

export function appendMergeEntry(dir: string, entry: MergeHistoryEntry): void {
  const history = readHistory(dir);
  history.entries.push(entry);
  writeHistory(dir, history);
}
