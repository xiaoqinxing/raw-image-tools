import { test, expect } from '@playwright/test';

test('status bar version opens the generated changelog', async ({ page }) => {
  await page.goto('/');

  const version = page.getByTestId('app-version');
  await expect(version).toBeVisible();
  await expect(version).toHaveText(/^v\d+\.\d+\.\d+/);
  await version.click();

  const dialog = page.getByTestId('changelog-dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole('heading', { name: '更新日志' })).toBeVisible();
  await expect(dialog.getByTestId('changelog-entry').first()).toBeVisible();
  await expect(dialog.getByText('当前', { exact: true })).toBeVisible();

  await page.getByRole('button', { name: '关闭更新日志' }).click();
  await expect(dialog).toBeHidden();

  // The project menu exposes the same dialog for discoverability.
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.getByRole('button', { name: /更新日志/ }).click();
  await expect(page.getByTestId('changelog-dialog')).toBeVisible();
});
