import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

test('gray-point WB samples the linear RAW stage, not the displayed stage', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);

  await page.locator('aside.app-right').getByRole('button', { name: '灰点' }).click();
  const host = page.locator('.canvas-host').first();
  const box = await host.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.click(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);

  const toast = page.locator('.toast');
  await expect(toast).toContainText('灰点', { timeout: 10_000 });
  const text = await toast.innerText();
  const match = text.match(/均值\s*([\d.]+)\s*\/\s*([\d.]+)\s*\/\s*([\d.]+)/);
  expect(match).toBeTruthy();

  // test-gradient.dng is ~0.50 in the linear RAW domain; the display-sRGB
  // preview of the same image is ~0.73. Reading the wrong stage is visible.
  const means = [Number(match![1]), Number(match![2]), Number(match![3])];
  for (const value of means) {
    expect(value).toBeGreaterThan(0.45);
    expect(value).toBeLessThan(0.55);
  }

  const wb = await page.evaluate(() => {
    const state = (window as unknown as { __rawlab: { useStore: { getState: () => { activeId: string; docs: Record<string, { params: { wb: { mode: string; multipliers: number[] } } }> } } } }).__rawlab.useStore.getState();
    const doc = state.docs[state.activeId];
    return { mode: doc.params.wb.mode, multipliers: doc.params.wb.multipliers };
  });
  expect(wb.mode).toBe('picked');
  expect(wb.multipliers[0]).toBeCloseTo(1, 2);
  expect(wb.multipliers[1]).toBe(1);
  expect(wb.multipliers[2]).toBe(1);
  expect(wb.multipliers[3]).toBeCloseTo(1, 2);
});
