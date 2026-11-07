import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

async function expectNoPageOverflow(page: import('@playwright/test').Page) {
  const size = await page.evaluate(() => ({
    innerWidth: window.innerWidth,
    innerHeight: window.innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
  }));
  expect(size.scrollWidth).toBeLessThanOrEqual(size.innerWidth + 1);
  expect(size.scrollHeight).toBeLessThanOrEqual(size.innerHeight + 1);
}

test('layout adapts from desktop to tablet, phone and landscape', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.locator('.canvas-host canvas')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(/1024 bins/).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('.app-left')).toBeVisible();
  await expect(page.locator('.app-right')).toBeVisible();
  await expectNoPageOverflow(page);

  // Tablet: both side panels become drawers over the full-width canvas.
  await page.setViewportSize({ width: 1024, height: 768 });
  await expect(page.locator('.app-left')).toBeHidden();
  await expect(page.locator('.app-right')).toBeHidden();
  const imagesButton = page.locator('.app-header').getByRole('button', { name: '图像', exact: true });
  await imagesButton.click();
  await expect(page.locator('.app-left')).toHaveClass(/is-open/);
  await expect(page.locator('.app-left').getByText('快照', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭图像面板' }).click();
  await expect(page.locator('.app-left')).not.toHaveClass(/is-open/);

  const pipelineButton = page.locator('.app-header').getByRole('button', { name: '管线', exact: true });
  await pipelineButton.click();
  await expect(page.locator('.app-right')).toHaveClass(/is-open/);
  await expect(page.locator('.app-right').getByText('ISP 管线', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭管线面板' }).click();
  await expect(page.locator('.app-right')).not.toHaveClass(/is-open/);
  await expectNoPageOverflow(page);

  // Phone: header remains usable and dialogs stay inside the viewport.
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(imagesButton).toBeVisible();
  await expect(pipelineButton).toBeVisible();
  await expect(page.locator('.canvas-host canvas')).toBeVisible();
  await expectNoPageOverflow(page);

  await imagesButton.click();
  await expect(page.locator('.app-left')).toHaveClass(/is-open/);
  await page.getByRole('button', { name: '关闭图像面板' }).click();

  await page.locator('.app-header').getByRole('button', { name: /导入/ }).first().click();
  const modal = await page.locator('.modal').boundingBox();
  expect(modal).not.toBeNull();
  expect(modal!.x).toBeGreaterThanOrEqual(0);
  expect(modal!.y).toBeGreaterThanOrEqual(0);
  expect(modal!.x + modal!.width).toBeLessThanOrEqual(390.5);
  expect(modal!.y + modal!.height).toBeLessThanOrEqual(844.5);
  await page.locator('.modal').getByRole('button', { name: '取消', exact: true }).click();
  await expectNoPageOverflow(page);

  // Short landscape: analysis auto-folds to preserve canvas space, and can be reopened.
  await page.setViewportSize({ width: 844, height: 390 });
  await expect(page.locator('.analysis-dock')).toHaveClass(/is-collapsed/);
  await expectNoPageOverflow(page);
  await page.getByTestId('analysis-tab-histogram').click();
  await expect(page.locator('.analysis-dock')).not.toHaveClass(/is-collapsed/);
  await expect(page.getByText(/1024 bins/).first()).toBeVisible();
  await expectNoPageOverflow(page);
});
