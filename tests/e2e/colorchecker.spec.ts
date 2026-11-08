import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-cc.raw');

test('colorchecker manual corners and CCM fit', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.getByRole('button', { name: '裸 RAW 二进制' }).click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByLabel('存储宽').fill('600');
  await page.getByLabel('存储高').fill('400');
  await page.getByLabel('black DN').fill('0');
  await page.getByLabel('white DN').fill('4095');
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-cc.raw').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1500);

  await page.getByTestId('analysis-tab-colorchecker').click();
  await page.getByRole('button', { name: '四角框选' }).click();
  const pts = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId];
    const host = document.querySelector('main .canvas-host') as HTMLElement;
    const r = host.getBoundingClientRect();
    const imgW = d.meta.geometry.active.w, imgH = d.meta.geometry.active.h;
    const fit = Math.min(r.width / imgW, r.height / imgH) * 0.96;
    const scale = fit * d.view.zoom;
    const map = (x: number, y: number) => ({
      x: r.left + r.width / 2 + (x - d.view.panX) * scale,
      y: r.top + r.height / 2 + (y - d.view.panY) * scale,
    });
    return [map(50, 30), map(550, 30), map(550, 370), map(50, 370)];
  });
  for (const p of pts) await page.mouse.click(p.x, p.y);
  await expect(page.getByText('四角已选，点击下方“拟合 CCM”').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '拟合 CCM', exact: true }).click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText('CCM 拟合完成', { timeout: 30_000 });
  await expect(toast).toContainText(/mean ΔE00 0\.0\d+/);
});
