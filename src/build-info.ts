import type { BuildInfo } from './core/build-info';

declare const __BUILD_INFO__: BuildInfo;

const FALLBACK: BuildInfo = {
  version: '0.0.0',
  packageVersion: '0.0.0',
  commit: '',
  shortCommit: '',
  date: '',
  commitCount: 0,
  repository: '',
  changelog: [],
};

/**
 * Build metadata injected by vite.config.ts (`define.__BUILD_INFO__`).
 * The fallback only applies when this module is loaded outside a Vite build,
 * e.g. by an editor or a test runner without the project config.
 */
export const BUILD_INFO: BuildInfo = typeof __BUILD_INFO__ === 'undefined' ? FALLBACK : __BUILD_INFO__;

export type { BuildCommit, BuildInfo } from './core/build-info';
