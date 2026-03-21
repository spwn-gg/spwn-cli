import { describe, it, expect } from 'vitest';
import { normalizeRepoUrl, repoUrlsMatch } from '../../src/utils/url-normalize.js';

describe('normalizeRepoUrl', () => {
  it('strips .git suffix', () => {
    expect(normalizeRepoUrl('https://github.com/org/repo.git')).toBe('github.com/org/repo');
  });

  it('handles SSH format', () => {
    expect(normalizeRepoUrl('git@github.com:org/repo.git')).toBe('github.com/org/repo');
  });

  it('handles SSH format without .git', () => {
    expect(normalizeRepoUrl('git@github.com:org/repo')).toBe('github.com/org/repo');
  });

  it('strips https protocol', () => {
    expect(normalizeRepoUrl('https://github.com/org/repo')).toBe('github.com/org/repo');
  });

  it('strips http protocol', () => {
    expect(normalizeRepoUrl('http://github.com/org/repo')).toBe('github.com/org/repo');
  });

  it('lowercases host', () => {
    expect(normalizeRepoUrl('https://GitHub.COM/org/repo')).toBe('github.com/org/repo');
  });

  it('preserves path case', () => {
    expect(normalizeRepoUrl('https://github.com/Org/Repo')).toBe('github.com/Org/Repo');
  });

  it('removes trailing slashes', () => {
    expect(normalizeRepoUrl('https://github.com/org/repo/')).toBe('github.com/org/repo');
  });

  it('removes multiple trailing slashes', () => {
    expect(normalizeRepoUrl('https://github.com/org/repo///')).toBe('github.com/org/repo');
  });

  it('strips default HTTPS port', () => {
    expect(normalizeRepoUrl('https://github.com:443/org/repo')).toBe('github.com/org/repo');
  });

  it('strips default HTTP port', () => {
    expect(normalizeRepoUrl('http://github.com:80/org/repo')).toBe('github.com/org/repo');
  });

  it('preserves non-default ports', () => {
    expect(normalizeRepoUrl('https://git.example.com:8443/org/repo')).toBe('git.example.com:8443/org/repo');
  });

  it('strips userinfo', () => {
    expect(normalizeRepoUrl('https://user:pass@github.com/org/repo')).toBe('github.com/org/repo');
  });

  it('handles whitespace', () => {
    expect(normalizeRepoUrl('  https://github.com/org/repo  ')).toBe('github.com/org/repo');
  });
});

describe('repoUrlsMatch', () => {
  it('matches SSH and HTTPS forms', () => {
    expect(repoUrlsMatch(
      'git@github.com:org/repo.git',
      'https://github.com/org/repo',
    )).toBe(true);
  });

  it('matches with and without .git suffix', () => {
    expect(repoUrlsMatch(
      'https://github.com/org/repo.git',
      'https://github.com/org/repo',
    )).toBe(true);
  });

  it('matches case-insensitive host', () => {
    expect(repoUrlsMatch(
      'https://GitHub.COM/org/repo',
      'https://github.com/org/repo',
    )).toBe(true);
  });

  it('does not match different repos', () => {
    expect(repoUrlsMatch(
      'https://github.com/org/repo-a',
      'https://github.com/org/repo-b',
    )).toBe(false);
  });

  it('does not match different orgs', () => {
    expect(repoUrlsMatch(
      'https://github.com/org1/repo',
      'https://github.com/org2/repo',
    )).toBe(false);
  });
});
