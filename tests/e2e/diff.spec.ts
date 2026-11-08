import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

test('A/B diff metrics are computed in the render worker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  // Compare gamma against bypassed gamma so the diff is guaranteed non-zero.
  await page.locator('main select').first().selectOption('gamma');
  await page.getByRole('button', { name: '差异', exact: true }).first().click();
  await page.getByTestId('analysis-tab-diff').click();
  await expect(page.getByTestId('analysis-range')).toContainText('尚未框选');
  await page.getByTestId('analysis-range').getByRole('button', { name: '框选' }).click();

  const host = page.locator('.canvas-host').first();
  const box = await host.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * 0.3, box!.y + box!.height * 0.3);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * 0.7, box!.y + box!.height * 0.7, { steps: 6 });
  await page.mouse.up();

  await expect(page.getByText('MAE')).toBeVisible({ timeout: 20_000 });
  const diff = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId];
    return d.analysis.diff ?? null;
  });
  expect(diff).toBeTruthy();
  expect(diff.kind).toBe('diff');
  expect(diff.metrics.mae).toBeGreaterThan(0);
  expect(diff.metrics.psnrDb).toBeLessThan(100);
  expect(diff.roi).toBeTruthy();
  expect(diff.width).toBeGreaterThan(8);
  expect(diff.height).toBeGreaterThan(8);
  expect(diff.width).toBeLessThanOrEqual(256);
  expect(diff.height).toBeLessThanOrEqual(192);
});
