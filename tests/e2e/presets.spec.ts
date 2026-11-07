import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

test('presets save, apply and export', async ({ page }) => {
  page.on('dialog', (d) => d.accept('E2E Preset'));
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.wb.multipliers = [1.2, 1, 1, 0.8];
    s.setParams(d.id, p);
  });

  const panel = page.locator('aside').last();
  await panel.locator('button').filter({ hasText: '预设' }).first().click();
  await panel.getByRole('button', { name: '保存当前' }).click();
  await expect.poll(() => page.evaluate(() => window.__rawlab.useStore.getState().presets.length)).toBe(1);
  expect(await page.evaluate(() => window.__rawlab.useStore.getState().presets[0].params.wb.multipliers)).toEqual([1.2, 1, 1, 0.8]);

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.wb.multipliers = [1, 1, 1, 1];
    s.setParams(d.id, p);
  });
  await panel.locator('select').last().selectOption({ label: 'E2E Preset' });
  await panel.getByRole('button', { name: '应用', exact: true }).click();
  await expect.poll(() => page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    return s.docs[s.activeId!].params.wb.multipliers;
  })).toEqual([1.2, 1, 1, 0.8]);

  const downloadPromise = page.waitForEvent('download');
  await panel.getByRole('button', { name: '导出', exact: true }).click();
  const download = await downloadPromise;
  const json = JSON.parse(fs.readFileSync(await download.path()!, 'utf8'));
  expect(json.schema).toBe('rawlab.presets');
  expect(json.presets.length).toBeGreaterThanOrEqual(1);
  expect(json.presets[0].params.wb.multipliers).toEqual([1.2, 1, 1, 0.8]);
});
