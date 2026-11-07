import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

test('project JSON can be reopened and relinked', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);

  const id = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const id = s.activeId!;
    const d = s.docs[id];
    const params = structuredClone(d.params);
    params.wb.multipliers = [1.2, 1, 1, 0.9];
    params.sharpen.bypass = false;
    params.sharpen.amount = 77;
    s.setParams(id, params);
    return id;
  });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.getByRole('button', { name: '保存工程 JSON' }).click();
  const download = await downloadPromise;
  const projectPath = await download.path();
  expect(projectPath).toBeTruthy();
  const json = JSON.parse(fs.readFileSync(projectPath!, 'utf8'));
  expect(json.images[0].id).toBe(id);

  await page.reload();
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.locator('input[accept*="rawlab"]').setInputFiles(projectPath!);
  await expect(page.getByText('重新关联 RAW 文件', { exact: true })).toBeVisible();
  await page.locator(`input[data-relink-main="${id}"]`).setInputFiles(fixture);
  await expect(page.getByText('已关联').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '完成恢复' }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible();

  const restored = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    return {
      id: s.activeId,
      wb: d.params.wb.multipliers,
      amount: d.params.sharpen.amount,
      bypass: d.params.sharpen.bypass,
      stage: d.stage,
    };
  });
  expect(restored.id).toBe(id);
  expect(restored.wb).toEqual([1.2, 1, 1, 0.9]);
  expect(restored.amount).toBe(77);
  expect(restored.bypass).toBe(false);
});

test('project relink can attach a flat field', async ({ page }) => {
  const { makeTestDng } = await import('../fixtures/dng');
  const flat = makeTestDng({ width: 256, height: 192, black: 0, white: 4095 });

  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);

  await page.locator('header input[type=file]').setInputFiles({
    name: 'flat.dng',
    mimeType: 'image/x-adobe-dng',
    buffer: flat,
  });
  await expect(page.getByText(/平场已加载/).first()).toBeVisible({ timeout: 20_000 });

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.getByRole('button', { name: '保存工程 JSON' }).click();
  const projectPath = await (await downloadPromise).path();
  expect(projectPath).toBeTruthy();
  const project = JSON.parse(fs.readFileSync(projectPath!, 'utf8'));
  expect(project.images[0].flat).toBeTruthy();

  await page.reload();
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.locator('input[accept*="rawlab"]').setInputFiles(projectPath!);
  await expect(page.getByText('重新关联 RAW 文件', { exact: true })).toBeVisible();
  await page.locator(`input[data-relink-main="${project.images[0].id}"]`).setInputFiles(fixture);
  await page.locator('.modal input[accept=".dng,.raw,.bin"]').setInputFiles({
    name: 'flat.dng',
    mimeType: 'image/x-adobe-dng',
    buffer: flat,
  });
  await page.getByRole('button', { name: '关联所选文件' }).click();
  await expect(page.getByText('已关联').first()).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '完成恢复' }).click();

  const restored = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    return { hasFlat: !!d.flat, flatBypass: d.params.flat.bypass, flatId: d.params.flat.flatId };
  });
  expect(restored.hasFlat).toBe(true);
  expect(restored.flatBypass).toBe(false);
  expect(restored.flatId).toBeTruthy();
});

test('autosave can be restored from IndexedDB', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await expect.poll(() => page.evaluate(() => window.__rawlab.useStore.getState().order.length), { timeout: 30_000 }).toBe(1);
  await page.waitForTimeout(2600);

  await page.reload();
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.getByRole('button', { name: '恢复自动保存' }).click();
  await expect(page.getByText('重新关联 RAW 文件', { exact: true })).toBeVisible({ timeout: 20_000 });
  await page.getByRole('button', { name: '取消' }).first().click();
});
