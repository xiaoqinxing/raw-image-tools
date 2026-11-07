import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
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
