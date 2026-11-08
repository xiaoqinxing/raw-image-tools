/** @type {import('tailwindcss').Config} */
import { palette } from './src/ui/palette.ts';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: palette.ink,
        accent: palette.accent,
        warn: palette.warn,
        danger: palette.danger,
        ok: palette.ok,
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', '15px'],
        xs: ['11px', '16px'],
        sm: ['12px', '18px'],
        base: ['13px', '19px'],
      },
    },
  },
  plugins: [],
};
