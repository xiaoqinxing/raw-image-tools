export interface BuildCommit {
  sha: string;
  short: string;
  date: string;
  subject: string;
}

export interface BuildInfo {
  /** Display version: package major.minor + git commit count. */
  version: string;
  /** Version declared in package.json. */
  packageVersion: string;
  /** Full SHA of HEAD, when running from a git checkout. */
  commit: string;
  shortCommit: string;
  /** Author date of HEAD (YYYY-MM-DD). */
  date: string;
  commitCount: number;
  /** HTTPS repository URL without the .git suffix, when available. */
  repository: string;
  changelog: BuildCommit[];
}

/**
 * Compute the display version from the package version and total commit count.
 * The patch component tracks the number of commits so every push gets a new
 * version without manual edits. Non-semver inputs are returned unchanged.
 */
export function computeVersion(packageVersion: string, commitCount: number): string {
  if (!Number.isFinite(commitCount) || commitCount <= 0) return packageVersion;
  const match = /^(\d+)\.(\d+)/.exec(packageVersion);
  if (!match) return packageVersion;
  return `${match[1]}.${match[2]}.${Math.floor(commitCount)}`;
}

/** Parse `git log --pretty=format:%H%x1f%h%x1f%ad%x1f%s` output. */
export function parseGitLog(raw: string): BuildCommit[] {
  return raw
    .split('\n')
    .map((line) => line.split('\x1f'))
    .filter((parts) => parts.length >= 4)
    .map(([sha, short, date, subject]) => ({ sha, short, date, subject }));
}
