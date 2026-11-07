import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import { computeVersion, parseGitLog, type BuildInfo } from './src/core/build-info';

function git(args: string[]): string {
  return execFileSync('git', args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 8 * 1024 * 1024,
  }).trim();
}

function normalizeRepository(value: unknown): string {
  const raw = typeof value === 'string'
    ? value
    : value && typeof value === 'object' && typeof (value as { url?: unknown }).url === 'string'
      ? (value as { url: string }).url
      : '';
  if (!raw) return '';
  let url = raw.startsWith('git+') ? raw.slice(4) : raw;
  if (url.startsWith('github:')) return `https://github.com/${url.slice('github:'.length)}`;
  if (url.startsWith('git@github.com:')) return `https://github.com/${url.slice('git@github.com:'.length)}`.replace(/\.git$/, '');
  url = url.replace(/\.git$/, '');
  return /^https?:\/\//.test(url) ? url : '';
}

function readBuildInfo(): BuildInfo {
  const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
    version?: unknown;
    repository?: unknown;
  };
  const packageVersion = typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  const repository = normalizeRepository(pkg.repository);
  const fallbackDate = new Date().toISOString().slice(0, 10);
  try {
    const changelog = parseGitLog(git([
      'log',
      '-n',
      '100',
      '--date=short',
      '--pretty=format:%H%x1f%h%x1f%ad%x1f%s',
    ]));
    const commitCount = Number(git(['rev-list', '--count', 'HEAD'])) || changelog.length;
    return {
      version: computeVersion(packageVersion, commitCount),
      packageVersion,
      commit: changelog[0]?.sha ?? '',
      shortCommit: changelog[0]?.short ?? '',
      date: changelog[0]?.date ?? fallbackDate,
      commitCount,
      repository,
      changelog,
    };
  } catch {
    return {
      version: computeVersion(packageVersion, 0),
      packageVersion,
      commit: '',
      shortCommit: '',
      date: fallbackDate,
      commitCount: 0,
      repository,
      changelog: [],
    };
  }
}

const buildInfo = readBuildInfo();

export default defineConfig({
  base: process.env.PAGES_BASE ?? '/',
  define: {
    __BUILD_INFO__: JSON.stringify(buildInfo),
  },
  plugins: [react()],
  server: {
    port: 5173,
    headers: {
      // Not required for the app (all buffers are transferable), but harmless
      // and useful for future WASM threading experiments.
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
  },
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    exclude: ['@colorhythm/libraw-wasm'],
    // fft.js is first imported by the analysis worker, which Vite's startup
    // scan does not see. Pre-bundle it so a cold dev server does not trigger a
    // full page reload in the middle of E2E imports.
    include: ['fft.js'],
  },
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/unit/**/*.test.ts'],
    environment: 'node',
  },
});
