import { test, expect, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import { PNG } from 'pngjs';
import type { StageId } from '../../src/core/types';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

async function importDng(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1000);
}

async function setStage(page: Page, stage: StageId) {
  await page.evaluate((s) => {
    const state = window.__rawlab.useStore.getState();
    state.setSelectedStage(s as StageId);
    state.setAnalysisStage(s as StageId);
    window.__rawlab.renderActive();
  }, stage);
  await expect.poll(() => page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    return s.docs[s.activeId!].stage;
  }), { timeout: 15_000 }).toBe(stage);
}

async function exportPng(page: Page): Promise<PNG> {
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '导出', exact: true }).first().click();
  await page.getByRole('button', { name: '8-bit sRGB（默认）' }).click();
  await page.getByRole('button', { name: '导出', exact: true }).last().click();
  const download = await downloadPromise;
  const file = await download.path();
  expect(file).toBeTruthy();
  return PNG.sync.read(fs.readFileSync(file!));
}

function mean(png: PNG): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < png.data.length; i += 4) {
    sum += png.data[i] + png.data[i + 1] + png.data[i + 2];
    n += 3;
  }
  return sum / Math.max(1, n);
}

function mae(a: PNG, b: PNG): number {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < Math.min(a.data.length, b.data.length); i += 4) {
    sum += Math.abs(a.data[i] - b.data[i]);
    sum += Math.abs(a.data[i + 1] - b.data[i + 1]);
    sum += Math.abs(a.data[i + 2] - b.data[i + 2]);
    n += 3;
  }
  return sum / Math.max(1, n);
}

test('digital gain stage executes and scales the RAW output', async ({ page }) => {
  await importDng(page);

  // Enable the stage at 1x first so the viewer can actually land on it.
  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.digitalGain.bypass = false;
    p.digitalGain.global = 1;
    s.setParams(d.id, p);
    window.__rawlab.renderActive();
  });
  await setStage(page, 'digitalGain');
  const before = await exportPng(page);

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.digitalGain.global = 2;
    s.setParams(d.id, p);
    window.__rawlab.renderActive();
  });
  await expect.poll(() => page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    return d.stats?.timings.stages.digitalGain ?? 0;
  }), { timeout: 15_000 }).toBeGreaterThan(0);

  const after = await exportPng(page);
  expect(mean(after)).toBeGreaterThan(mean(before) + 10);
});

test('CSC saturation 0 neutralizes color and the standard matrix changes the result', async ({ page }) => {
  await importDng(page);
  await setStage(page, 'csc');

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.csc.saturation = 0;
    s.setParams(d.id, p);
    window.__rawlab.renderActive();
  });
  await page.waitForTimeout(500);

  const gray = await exportPng(page);
  let maxSpread = 0;
  for (let i = 0; i < gray.data.length; i += 4) {
    maxSpread = Math.max(
      maxSpread,
      Math.abs(gray.data[i] - gray.data[i + 1]),
      Math.abs(gray.data[i + 1] - gray.data[i + 2]),
    );
  }
  expect(maxSpread).toBeLessThanOrEqual(2);

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.csc.saturation = 200;
    p.csc.hue = 60;
    p.csc.standard = 'bt709';
    s.setParams(d.id, p);
    window.__rawlab.renderActive();
  });
  await page.waitForTimeout(500);
  const bt709 = await exportPng(page);

  await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const d = s.docs[s.activeId!];
    const p = structuredClone(d.params);
    p.csc.standard = 'bt601';
    s.setParams(d.id, p);
    window.__rawlab.renderActive();
  });
  await page.waitForTimeout(500);
  const bt601 = await exportPng(page);

  expect(mae(bt709, bt601)).toBeGreaterThan(0.01);
});
