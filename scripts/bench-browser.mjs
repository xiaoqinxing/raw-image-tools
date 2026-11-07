import { chromium } from '@playwright/test';

const arg = (name, fallback) => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : fallback;
};
const width = Number(arg('width', process.env.BENCH_WIDTH || 6000));
const height = Number(arg('height', process.env.BENCH_HEIGHT || 4000));
const algorithms = String(arg('algorithms', process.env.BENCH_ALGORITHMS || 'mhc')).split(',').filter(Boolean);
const url = String(arg('url', process.env.BENCH_URL || 'http://127.0.0.1:5173/'));
const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;

const browser = await chromium.launch({
  headless: true,
  ...(executablePath ? { executablePath } : {}),
  args: [
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--js-flags=--max-old-space-size=4096',
  ],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on('pageerror', (e) => console.error('[pageerror]', e.message));
page.on('console', (m) => {
  if (m.type() === 'error') console.error('[page]', m.text());
});
await page.goto(url, { waitUntil: 'networkidle' });
await page.waitForFunction(() => Boolean(window.__rawlab?.bench), null, { timeout: 30_000 });
const result = await page.evaluate(
  ({ width, height, algorithms }) => window.__rawlab.bench({ width, height, algorithms }),
  { width, height, algorithms },
);
console.log(JSON.stringify(result, null, 2));
await browser.close();
