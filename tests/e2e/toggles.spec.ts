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

test('gamma bypass shows the linear output and gates the sharpen stage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  const host = page.locator('.canvas-host').first();
  const gammaRow = page.locator('.stage-row', { hasText: 'Gamma' }).first();
  const sharpenRow = page.locator('.stage-row', { hasText: 'USM 锐化' }).first();
  await expect(gammaRow).toContainText('ON');
  await expect(sharpenRow).toContainText('BYP');

  const generation = () => page.evaluate(() => {
    const s = (window as unknown as { __rawlab: { useStore: { getState: () => { activeId: string; docs: Record<string, { generation: number }> } } } }).__rawlab.useStore.getState();
    return s.docs[s.activeId].generation;
  });

  const before = PNG.sync.read(await host.screenshot());
  const genBefore = await generation();
  await gammaRow.getByRole('switch').click();
  await expect(page.getByText('LINEAR', { exact: true })).toBeVisible({ timeout: 10_000 });
  await expect.poll(generation, { timeout: 10_000 }).toBeGreaterThan(genBefore);
  await page.waitForTimeout(400);
  const after = PNG.sync.read(await host.screenshot());
  // Linear output is substantially darker than the sRGB-encoded preview.
  expect(mae(before, after)).toBeGreaterThan(10);

  // Restore gamma and enable sharpen.
  await gammaRow.getByRole('switch').click();
  await expect(page.getByText('LINEAR', { exact: true })).toHaveCount(0);
  await sharpenRow.getByRole('switch').click();
  await expect(sharpenRow).toContainText('ON');
  await page.waitForTimeout(300);
  // Expand the row so the upstream-bypass hint is rendered.
  await sharpenRow.locator('button').first().click();
  await expect.poll(() => page.evaluate(() => {
    const s = (window as unknown as { __rawlab: { useStore: { getState: () => { activeId: string; docs: Record<string, { stats: { timings: { stages: Record<string, number> } } | null }> } } } }).__rawlab.useStore.getState();
    return s.docs[s.activeId].stats?.timings.stages.sharpen ?? 0;
  }), { timeout: 10_000 }).toBeGreaterThan(0);

  // Sharpen depends on the gamma stage; show SKIP instead of pretending it ran.
  await gammaRow.getByRole('switch').click();
  await expect(sharpenRow).toContainText('SKIP');
  await expect(page.getByText('上游阶段已 bypass，本阶段暂不执行。')).toBeVisible();
});
