import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { PNG } from 'pngjs';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

async function importDng(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible();
  await page.waitForTimeout(1200);
}

test('imports DNG, renders, histograms and exports 16-bit PNG', async ({ page }) => {
  await importDng(page);
  await expect(page.locator('canvas').first()).toBeVisible();
  await page.locator('.analysis-collapse').click();
  await expect(page.getByText(/1024 bins/).first()).toBeVisible();

  // Switch the viewed stage to linear sRGB and back to final.
  const toolbarSelect = page.locator('main select').first();
  await toolbarSelect.selectOption('csc');
  await expect(page.getByText(/stage csc/).first()).toBeVisible();
  await toolbarSelect.selectOption('sharpen');
  await expect(page.getByText(/stage gamma|stage sharpen/).first()).toBeVisible();

  // Quality demosaic runs AHD on the CPU inside the render worker.
  await page.getByRole('button', { name: 'Quality · AHD' }).click();
  await expect.poll(() => page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    return s.docs[s.activeId!].params.demosaic.algorithm;
  })).toBe('ahd');
  await page.waitForTimeout(500);
  await expect(page.getByText(/stage gamma|stage sharpen/).first()).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).first().click();
  await page.getByRole('button', { name: '16-bit PNG' }).click();
  await page.getByRole('button', { name: '导出', exact: true }).last().click();
  const download = await downloadPromise;
  const p = await download.path();
  expect(p).toBeTruthy();
  const png = PNG.sync.read(fs.readFileSync(p!));
  expect(png.width).toBe(256);
  expect(png.height).toBe(192);

  // Intermediate-stage export uses the toolbar-selected stage.
  await toolbarSelect.selectOption('csc');
  const midDownloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).first().click();
  await page.getByRole('button', { name: '8-bit sRGB（默认）' }).click();
  await page.getByRole('button', { name: '导出', exact: true }).last().click();
  const midDownload = await midDownloadPromise;
  expect(midDownload.suggestedFilename()).toContain('_csc_8bit.png');
  const midPng = PNG.sync.read(fs.readFileSync(await midDownload.path()!));
  expect(midPng.width).toBe(256);
  expect(midPng.height).toBe(192);

  const projectDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '工程', exact: true }).click();
  await page.getByRole('button', { name: '保存工程 JSON' }).click();
  const pd = await projectDownload;
  const json = JSON.parse(fs.readFileSync(await pd.path()!, 'utf8'));
  expect(json.schema).toBe('rawlab.project');
  expect(json.images[0].fileName).toBe('test-gradient.dng');
  expect(json.images[0].params).toBeTruthy();
});
