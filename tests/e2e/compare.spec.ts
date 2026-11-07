import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

async function importDng(page: import('@playwright/test').Page, name: string) {
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', {
    name,
    mimeType: 'image/x-adobe-dng',
    buffer: fs.readFileSync(fixture),
  });
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText(name).first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(800);
}

test('multi-image compare keeps view synced and swaps A/B entries', async ({ page }) => {
  await page.goto('/');
  await importDng(page, 'test-gradient.dng');
  await importDng(page, 'test-gradient2.dng');
  await importDng(page, 'test-gradient3.dng');

  const ids = await page.evaluate(() => window.__rawlab.useStore.getState().order);
  expect(ids.length).toBe(3);

  // Activate compare through the left-rail button on a non-active image.
  await page.getByRole('button', { name: '对比', exact: true }).first().click();
  await expect.poll(() => page.evaluate(() => window.__rawlab.useStore.getState().compareMode)).toBe(true);
  const initial = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    return { active: s.activeId, compareId: s.compareId };
  });
  expect(initial.active).toBe(ids[2]);
  expect(initial.compareId).toBe(ids[0]);
  await expect(page.locator('main .canvas-host canvas')).toHaveCount(2);

  // Clicking the B image in the left rail makes it active. The previous A
  // becomes the new B, so the comparison never references the same image twice.
  await page.getByText('test-gradient.dng').first().click();
  await expect.poll(() => page.evaluate(() => window.__rawlab.useStore.getState().activeId)).toBe(ids[0]);
  const swapped = await page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    return { active: s.activeId, compareId: s.compareId };
  });
  expect(swapped.compareId).toBe(ids[2]);

  // Quad layout fills remaining panes from the image list.
  await page.getByRole('button', { name: '4', exact: true }).click();
  await expect(page.locator('main .canvas-host canvas')).toHaveCount(3);
  await page.getByRole('button', { name: '2V', exact: true }).click();
  await expect(page.locator('main .canvas-host canvas')).toHaveCount(2);

  // Wheel zoom is mirrored to both documents.
  const host = page.locator('main .canvas-host').first();
  const box = await host.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.wheel(0, -240);
  await expect.poll(() => page.evaluate(() => {
    const s = window.__rawlab.useStore.getState();
    const a = s.docs[s.activeId!];
    const b = s.docs[s.compareId!];
    const c = (s.order as string[]).map((id: string) => s.docs[id]).find((d: any) => d.id !== a.id && d.id !== b.id);
    return Math.abs(a.view.zoom - b.view.zoom) < 1e-6 && (!c || Math.abs(a.view.zoom - c.view.zoom) < 1e-6);
  })).toBe(true);
});
