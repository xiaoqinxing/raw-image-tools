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
  for (let i = 0; i < pts.length; i++) {
    await page.mouse.click(pts[i].x, pts[i].y);
    if (i < 3) {
      await expect(page.getByTestId(`cc-corner-${i + 1}`)).toBeVisible();
      await expect(page.locator('.canvas-hint span').first()).toContainText(`已选 ${i + 1}/4`);
    }
  }
  await expect(page.getByTestId('cc-corner-picking')).toHaveCount(0);
  await expect(page.getByText('四角已选，点击下方“拟合 CCM”').first()).toBeVisible({ timeout: 10_000 });
  await page.getByRole('button', { name: '拟合 CCM', exact: true }).click();
  const toast = page.locator('.toast');
  await expect(toast).toContainText('CCM 拟合完成', { timeout: 30_000 });
  await expect(toast).toContainText(/mean ΔE00 0\.0\d+/);
});

test('colorchecker shows sample boxes, weights and a*b* plot', async ({ page }) => {
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
  await expect(page.getByTestId('cc-sample-0')).toHaveCount(0);

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
  await expect(page.getByTestId('cc-sample-0')).toHaveCount(1, { timeout: 10_000 });
  await expect(page.getByTestId('cc-sample-23')).toHaveCount(1);

  // The dedicated weight table is available before fitting and accepts manual values.
  await page.getByRole('button', { name: '权重表', exact: true }).click();
  await expect(page.getByTestId('cc-weight-row-0')).toContainText('待拟合');
  await page.getByLabel('色块 1 权重').fill('0');

  await page.getByRole('button', { name: '拟合 CCM', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('CCM 拟合完成', { timeout: 30_000 });
  await expect(page.getByTestId('cc-fit-summary')).toContainText('参与 23');
  await expect(page.getByTestId('cc-saturation')).toContainText(/饱和度\s*\d+\.\d+%/);
  await expect(page.getByRole('button', { name: 'a*b* 图' })).toBeEnabled();
  await page.getByRole('button', { name: 'a*b* 图' }).click();
  await expect(page.getByLabel('ColorChecker a*b* 偏差图')).toBeVisible();
  const chromaToggle = page.getByRole('button', { name: '色度背景' });
  await expect(chromaToggle).toHaveAttribute('aria-pressed', 'true');
  await chromaToggle.click();
  await expect(chromaToggle).toHaveAttribute('aria-pressed', 'false');
  await chromaToggle.click();
  await expect(chromaToggle).toHaveAttribute('aria-pressed', 'true');
  const desktopBox = await page.getByLabel('ColorChecker a*b* 偏差图').boundingBox();
  expect(desktopBox?.height ?? 0).toBeGreaterThan(120);
  await page.setViewportSize({ width: 390, height: 844 });
  const mobileBox = await page.getByLabel('ColorChecker a*b* 偏差图').boundingBox();
  expect(mobileBox?.height ?? 0).toBeGreaterThan(100);
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.getByRole('button', { name: '权重表', exact: true }).click();
  await expect(page.getByLabel('色块 1 权重')).toHaveValue('0');
  await page.getByLabel('色块 2 权重').fill('2.5');
  await page.getByTestId('cc-target-saturation-thumb').focus();
  await page.keyboard.press('ArrowRight');
  await page.getByRole('button', { name: '拟合 CCM', exact: true }).click();
  await expect(page.locator('.toast')).toContainText('CCM 拟合完成', { timeout: 30_000 });
  await expect(page.getByTestId('cc-fit-summary')).toContainText('参与 23');
  await expect(page.getByTestId('analysis-warnings')).toContainText('目标已调整', { timeout: 10_000 });
  await page.getByRole('button', { name: '权重表', exact: true }).click();
  await expect(page.getByLabel('色块 2 权重')).toHaveValue('2.5');

  await page.getByTestId('analysis-tab-histogram').click();
  await expect(page.getByTestId('cc-sample-0')).toHaveCount(0);
  await page.getByTestId('analysis-tab-colorchecker').click();
  await expect(page.getByTestId('cc-sample-0')).toHaveCount(1, { timeout: 10_000 });
});
