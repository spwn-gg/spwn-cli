/**
 * Normalize a git remote URL to a comparable form:
 *   git@github.com:org/repo.git  →  github.com/org/repo
 *   https://github.com/org/repo  →  github.com/org/repo
 */
export function normalizeRepoUrl(url: string): string {
  let normalized = url.trim();

  // Handle SSH format: git@host:org/repo or user@host:org/repo
  const sshMatch = normalized.match(/^[^@]+@([^:]+):(.+)$/);
  if (sshMatch) {
    normalized = `https://${sshMatch[1]}/${sshMatch[2]}`;
  }

  // Strip protocol
  normalized = normalized.replace(/^[a-zA-Z][a-zA-Z+.-]*:\/\//, '');

  // Strip userinfo (user:pass@)
  normalized = normalized.replace(/^[^@/]+@/, '');

  // Strip default ports
  normalized = normalized.replace(/:(443|80)(\/|$)/, '$2');

  // Remove .git suffix
  normalized = normalized.replace(/\.git$/, '');

  // Remove trailing slashes
  normalized = normalized.replace(/\/+$/, '');

  // Lowercase the host portion (everything before first /)
  const slashIdx = normalized.indexOf('/');
  if (slashIdx !== -1) {
    normalized =
      normalized.substring(0, slashIdx).toLowerCase() +
      normalized.substring(slashIdx);
  } else {
    normalized = normalized.toLowerCase();
  }

  return normalized;
}

export function repoUrlsMatch(a: string, b: string): boolean {
  return normalizeRepoUrl(a) === normalizeRepoUrl(b);
}
