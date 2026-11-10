import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

test('bilateral denoise shader executes in the worker', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(900);

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.denoise.bypass = false;
    p.denoise.method = 'bilateral';
    p.denoise.radius = 5;
    p.denoise.luma = 80;
    p.denoise.chroma = 40;
    p.denoise.detail = 50;
    s.setParams(d.id, p);
    window.__rawlab.renderActive();
  });

  await expect.poll(() => page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    return d.stats?.timings.stages.denoise ?? 0;
  }), { timeout: 20_000 }).toBeGreaterThan(0);

  const state = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    return { toast: s.toast, stage: s.docs[s.activeId!].stage };
  });
  expect(state.stage).toBe('csc');
  expect(state.toast ?? '').not.toContain('shader');
});
