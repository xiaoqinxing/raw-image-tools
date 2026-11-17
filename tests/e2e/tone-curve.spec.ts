import { test, expect } from '@playwright/test';
import path from 'node:path';
import { PNG } from 'pngjs';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

function mae(a: PNG, b: PNG): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < a.data.length; i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    n += 3;
  }
  return sum / Math.max(1, n);
}

function meanLuma(png: PNG): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    sum += 0.2126 * png.data[i] + 0.7152 * png.data[i + 1] + 0.0722 * png.data[i + 2];
    n++;
  }
  return sum / Math.max(1, n);
}

async function importDng(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForFunction(() => {
    const s = (window as unknown as {
      __rawlab: {
        useStore: {
          getState: () => { activeId: string; docs: Record<string, { stats: unknown }> };
        };
      };
    }).__rawlab.useStore.getState();
    return !!s.docs[s.activeId]?.stats;
  }, undefined, { timeout: 30_000 });
  await page.waitForTimeout(300);
}

function readGeneration(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const s = (window as unknown as {
      __rawlab: {
        useStore: {
          getState: () => { activeId: string; docs: Record<string, { generation: number }> };
        };
      };
    }).__rawlab.useStore.getState();
    return s.docs[s.activeId].generation;
  });
}

async function waitForToneCurveRender(page: import('@playwright/test').Page, minGeneration: number) {
  let previous = -1;
  for (let i = 0; i < 100; i++) {
    const state = await page.evaluate(() => {
      const s = (window as unknown as {
        __rawlab: {
          useStore: {
            getState: () => {
              activeId: string;
              docs: Record<string, { generation: number; stats: { timings: { stages: Record<string, number> } } | null }>;
            };
          };
        };
      }).__rawlab.useStore.getState();
      const doc = s.docs[s.activeId];
      return { generation: doc.generation, timing: doc.stats?.timings.stages.toneCurve ?? 0 };
    });
    if (state.generation > minGeneration && state.timing > 0 && state.generation === previous) return;
    previous = state.generation;
    await page.waitForTimeout(200);
  }
  throw new Error('tone curve render did not settle');
}

function toneCurveParams(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const s = (window as unknown as {
      __rawlab: {
        useStore: {
          getState: () => { activeId: string; docs: Record<string, { params: { toneCurve: { bypass: boolean; points: Record<string, Array<{ x: number; y: number }>> } } }> };
        };
      };
    }).__rawlab.useStore.getState();
    return s.docs[s.activeId].params.toneCurve;
  });
}

test('tone curve edits apply, auto-enable and gate on gamma', async ({ page }) => {
  await importDng(page);
  const host = page.locator('.canvas-host').first();
  const row = page.locator('.stage-row', { hasText: '色调曲线' }).first();
  await expect(row).toContainText('BYP');

  const editor = page.locator('[data-testid="tone-curve-editor"]');
  await editor.scrollIntoViewIfNeeded();
  const box = await editor.boundingBox();
  expect(box).toBeTruthy();
  const before = PNG.sync.read(await host.screenshot());
  const beforeGen = await readGeneration(page);

  // Drag the black endpoint upward: this lifts blacks and must auto-enable the stage.
  await page.mouse.move(box!.x + 1, box!.y + box!.height - 1);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.02, box!.y + box!.height * 0.8, { steps: 3 });
  await page.mouse.up();

  await expect(row).toContainText('ON');
  await expect.poll(async () => (await toneCurveParams(page)).bypass).toBe(false);
  const lifted = await toneCurveParams(page);
  expect(lifted.points.rgb[0].y).toBeGreaterThan(0.1);
  await waitForToneCurveRender(page, beforeGen);
  const after = PNG.sync.read(await host.screenshot());
  expect(mae(before, after)).toBeGreaterThan(2);
  expect(meanLuma(after)).toBeGreaterThan(meanLuma(before) + 1);

  // Per-channel curves are independent from the RGB composite.
  const controls = page.locator('[data-testid="tone-curve-controls"]');
  await controls.getByRole('button', { name: 'R', exact: true }).click();
  const rGen = await readGeneration(page);
  await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
  await expect.poll(async () => (await toneCurveParams(page)).points.r.length).toBe(3);
  expect((await toneCurveParams(page)).points.rgb.length).toBe(2);
  await waitForToneCurveRender(page, rGen);

  // Reset returns the composite curve to identity.
  await controls.getByRole('button', { name: 'RGB', exact: true }).click();
  const resetGen = await readGeneration(page);
  await page.getByRole('button', { name: '重置 RGB' }).click();
  await expect.poll(async () => (await toneCurveParams(page)).points.rgb.length).toBe(2);
  expect((await toneCurveParams(page)).points.rgb[0].y).toBe(0);
  await waitForToneCurveRender(page, resetGen);
  const reset = PNG.sync.read(await host.screenshot());
  // An identity curve is an exact copy, not a 12-bit LUT approximation.
  expect(mae(before, reset)).toBeLessThan(1);
  expect(Math.abs(meanLuma(reset) - meanLuma(before))).toBeLessThan(1);

  // The curve lives after Gamma, so bypassing Gamma must gate it.
  const gammaRow = page.locator('.stage-row', { hasText: 'Gamma' }).first();
  await gammaRow.getByRole('switch').click();
  await expect(row).toContainText('SKIP');
  await gammaRow.getByRole('switch').click();
  await expect(row).toContainText('ON');
});
