/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0d0f',
          900: '#0f1215',
          850: '#12161a',
          800: '#171c21',
          750: '#1d232a',
          700: '#242c34',
          600: '#323d47',
          500: '#4b5965',
          400: '#6f7f8d',
          300: '#93a2af',
          200: '#c2ccd4',
          100: '#d7dde3',
        },
        accent: '#4ea1ff',
        warn: '#f0a742',
        danger: '#ff5d5d',
        ok: '#59c98a',
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'Segoe UI', 'PingFang SC', 'Hiragino Sans GB', 'Microsoft YaHei', 'Noto Sans CJK SC', 'Noto Sans SC', 'Source Han Sans SC', 'WenQuanYi Micro Hei', 'sans-serif'],
        mono: ['JetBrains Mono', 'SFMono-Regular', 'Consolas', 'monospace'],
      },
      fontSize: {
        '2xs': ['10px', '14px'],
        xs: ['11px', '15px'],
        sm: ['12px', '17px'],
        base: ['13px', '19px'],
      },
    },
  },
  plugins: [],
};
