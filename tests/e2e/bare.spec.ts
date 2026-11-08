import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-flat.raw');

test.setTimeout(120_000);

test('imports a bare RAW and reports bad configuration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.getByRole('button', { name: '裸 RAW 二进制' }).click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByLabel('存储宽').fill('64');
  await page.getByLabel('存储高').fill('48');
  await page.getByLabel('white DN').fill('4095');
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  // The first WebGL2 session in a cold CI browser can spend a while compiling
  // SwiftShader shaders. Wait for the document itself rather than the file
  // label in the dialog, then allow extra time for the histogram.
  await expect.poll(() => page.evaluate(() => window.__rawlab.useStore.getState().order.length), { timeout: 60_000 }).toBe(1);
  await page.locator('.analysis-collapse').click();
  await expect(page.getByText(/1024 bins/).first()).toBeVisible({ timeout: 30_000 });

  // Bad header offset: error should be explicit and the dialog should remain.
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.getByRole('button', { name: '裸 RAW 二进制' }).click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByLabel('存储宽').fill('64');
  await page.getByLabel('存储高').fill('48');
  await page.getByLabel('white DN').fill('4095');
  await page.getByLabel('header offset (B)').fill('999999');
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.locator('.modal').getByText(/文件长度不足/)).toBeVisible({ timeout: 20_000 });
});
