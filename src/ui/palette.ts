/**
 * Single source of truth for the workbench palette.
 *
 * `tailwind.config.js` reads this module, `src/styles.css` mirrors it through
 * CSS custom properties, and `tests/unit/theme.test.ts` asserts the two stay in
 * sync and keep a readable contrast floor.
 */
export const palette = {
  // Every step >= 500 is meant for text; 600/700/750 are border-only.
  ink: {
    950: '#101418',
    900: '#141a20',
    850: '#171d23',
    800: '#1e252c',
    750: '#242c34',
    700: '#2e3942',
    600: '#45525e',
    500: '#7f8e9c',
    400: '#94a3b0',
    300: '#b4c1cc',
    200: '#d5dde5',
    100: '#e7edf3',
  },
  accent: '#5cb0ff',
  warn: '#ffb85c',
  danger: '#ff7373',
  ok: '#5fd99a',
} as const;

export type InkStep = keyof typeof palette.ink;
