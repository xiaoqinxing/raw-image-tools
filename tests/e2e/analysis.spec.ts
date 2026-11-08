import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

async function importDng(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(/1024 bins/).first()).toBeVisible({ timeout: 20_000 });
}

test.describe('analysis scheduling and hover readout', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      const w = window as unknown as { __workerMsgs: Array<{ type?: string }> };
      w.__workerMsgs = [];
      const orig = Worker.prototype.postMessage;
      const patched = function (this: Worker, msg: unknown, transfer?: Transferable[]) {
        try {
          w.__workerMsgs.push({ type: (msg as { type?: string } | null)?.type });
        } catch {
          // ignore
        }
        return orig.call(this, msg as never, transfer as never);
      } as unknown as typeof Worker.prototype.postMessage;
      Worker.prototype.postMessage = patched;
    });
    await importDng(page);
  });

  test('analysis runs only while the dock is open and never dims the canvas', async ({ page }) => {
    const messages = () => page.evaluate(() => (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs);
    const clear = () => page.evaluate(() => { (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs = []; });
    const count = async (type: string) => (await messages()).filter((m) => m.type === type).length;

    // Collapsed dock: parameter changes must not schedule statistics.
    await page.locator('.analysis-collapse').click();
    await page.waitForTimeout(200);
    await clear();
    await page.locator('aside.app-right').getByRole('button', { name: '白平衡' }).first().click();
    await page.waitForTimeout(900);
    expect(await count('analyze')).toBe(0);
    expect(await count('renderPreview')).toBe(1);

    // Expanding the dock schedules exactly one automatic run.
    await clear();
    await page.locator('.analysis-collapse').click();
    await expect.poll(() => count('analyze'), { timeout: 10_000 }).toBeGreaterThan(0);
    await page.waitForTimeout(500);
    expect(await count('analyze')).toBe(1);

    // Manual "recalculate" must not post another preview or a blocking overlay.
    await page.evaluate(() => {
      const w = window as unknown as { __overlaySeen?: boolean };
      w.__overlaySeen = false;
      const obs = new MutationObserver(() => {
        if (document.querySelector('div.pointer-events-none.fixed.inset-0')) w.__overlaySeen = true;
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
    await clear();
    await page.getByTestId('analysis-run').click();
    await expect.poll(() => count('analyze'), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(400);
    expect(await count('renderPreview')).toBe(0);
    expect(await count('present')).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __overlaySeen?: boolean }).__overlaySeen)).toBe(false);
  });

  test('switching the viewed stage posts a single preview', async ({ page }) => {
    await page.evaluate(() => { (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs = []; });
    await page.locator('aside.app-right').getByRole('button', { name: 'CSC → 线性 sRGB' }).first().click();
    await expect.poll(async () => {
      const msgs = await page.evaluate(() => (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs);
      return msgs.filter((m) => m.type === 'renderPreview').length;
    }, { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(500);
    const msgs = await page.evaluate(() => (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs);
    expect(msgs.filter((m) => m.type === 'renderPreview').length).toBe(1);
  });

  test('hover readout shows RAW, white balance and stage RGB', async ({ page }) => {
    const host = page.locator('.canvas-host').first();
    const box = await host.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
    await expect(host.getByText(/RAW [RG]/)).toBeVisible({ timeout: 10_000 });
    const center = await host.innerText();
    expect(center).toContain('WB');
    expect(center).toContain('RGB');
    expect(center).toContain('RGGB');

    await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.4);
    await expect.poll(async () => host.innerText(), { timeout: 10_000 }).not.toBe(center);
  });
});
