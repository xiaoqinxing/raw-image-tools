import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-flat.raw');

test('imports a bare RAW and reports bad configuration', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.getByRole('button', { name: '裸 RAW 二进制' }).click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByLabel('存储宽').fill('64');
  await page.getByLabel('存储高').fill('48');
  await page.getByLabel('white DN').fill('4095');
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('flat.raw').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/1024 bins/).first()).toBeVisible({ timeout: 20_000 });

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
