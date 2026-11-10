import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

let messages: () => Promise<Array<{ type?: string }>>;
let clearMessages: () => Promise<void>;
let countMessages: (type: string) => Promise<number>;

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
    messages = () => page.evaluate(() => (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs);
    clearMessages = () => page.evaluate(() => { (window as unknown as { __workerMsgs: Array<{ type?: string }> }).__workerMsgs = []; });
    countMessages = async (type: string) => (await messages()).filter((m) => m.type === type).length;

    await page.goto('/');
    await page.getByRole('button', { name: '导入图像' }).first().click();
    await page.setInputFiles('.modal input[type=file]', fixture);
    await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
    await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
    await page.waitForTimeout(1200);
  });

  test('statistics stay idle while collapsed and refresh automatically when open', async ({ page }) => {
    await expect(page.locator('.analysis-dock')).toHaveClass(/is-collapsed/);
    expect(await countMessages('analyze')).toBe(0);

    // Collapsed: parameter changes must not schedule statistics.
    await clearMessages();
    await page.locator('aside.app-right').getByRole('button', { name: 'Fast · Bilinear' }).click();
    await expect.poll(() => page.evaluate(() => {
      const s = (window as unknown as { __rawlab: { useStore: { getState: () => { activeId: string; docs: Record<string, { generation: number }> } } } }).__rawlab.useStore.getState();
      return s.docs[s.activeId].generation;
    }), { timeout: 10_000 }).toBeGreaterThan(1);
    await page.waitForTimeout(800);
    expect(await countMessages('analyze')).toBe(0);

    // Expanding the dock schedules exactly one automatic run.
    await clearMessages();
    await page.locator('.analysis-collapse').click();
    await expect.poll(() => countMessages('analyze'), { timeout: 10_000 }).toBe(1);
    await expect(page.getByText(/1024 bins/).first()).toBeVisible();

    // Open dock: parameter changes refresh the statistics directly, with no stale badge.
    const beforeCreated = await page.evaluate(() => {
      const s = (window as unknown as { __rawlab: { useStore: { getState: () => { activeId: string; docs: Record<string, { analysis: Record<string, { createdAt?: number }> }> } } } }).__rawlab.useStore.getState();
      return s.docs[s.activeId].analysis.histogram?.createdAt ?? 0;
    });
    await clearMessages();
    await page.locator('aside.app-right').getByRole('button', { name: 'Fast · MHC' }).click();
    await expect.poll(() => countMessages('analyze'), { timeout: 10_000 }).toBe(1);
    await expect.poll(async () => page.evaluate(() => {
      const s = (window as unknown as { __rawlab: { useStore: { getState: () => { activeId: string; docs: Record<string, { analysis: Record<string, { createdAt?: number }> }> } } } }).__rawlab.useStore.getState();
      return s.docs[s.activeId].analysis.histogram?.createdAt ?? 0;
    }), { timeout: 10_000 }).toBeGreaterThan(beforeCreated);
    expect(await page.getByText('参数已变化').count()).toBe(0);

    // Manual "recalculate" must not post another preview or a blocking overlay.
    await page.evaluate(() => {
      const w = window as unknown as { __overlaySeen?: boolean };
      w.__overlaySeen = false;
      const obs = new MutationObserver(() => {
        if (document.querySelector('div.pointer-events-none.fixed.inset-0')) w.__overlaySeen = true;
      });
      obs.observe(document.body, { childList: true, subtree: true });
    });
    await clearMessages();
    await page.getByTestId('analysis-run').click();
    await expect.poll(() => countMessages('analyze'), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(400);
    expect(await countMessages('renderPreview')).toBe(0);
    expect(await countMessages('present')).toBe(0);
    expect(await page.evaluate(() => (window as unknown as { __overlaySeen?: boolean }).__overlaySeen)).toBe(false);

    // Collapsed again: no analysis work.
    await page.locator('.analysis-collapse').click();
    await clearMessages();
    await page.locator('aside.app-right').getByRole('button', { name: 'Fast · Bilinear' }).click();
    await page.waitForTimeout(1000);
    expect(await countMessages('analyze')).toBe(0);
  });

  test('switching the viewed stage posts a single preview', async ({ page }) => {
    await clearMessages();
    await page.locator('aside.app-right').getByRole('button', { name: /CSC RGB/ }).first().click();
    await expect.poll(() => countMessages('renderPreview'), { timeout: 10_000 }).toBe(1);
    await page.waitForTimeout(500);
    expect(await countMessages('renderPreview')).toBe(1);
  });

  test('resizes the analysis dock from its top edge', async ({ page }) => {
    const dock = page.locator('.analysis-dock');
    const handle = page.getByTestId('analysis-resize-handle');
    const viewportHeight = () => page.evaluate(() => {
      const w = window as unknown as { __rawlab: { useStore: { getState: () => { viewport: { height: number } } } } };
      return w.__rawlab.useStore.getState().viewport.height;
    });

    await expect(dock).toHaveClass(/is-collapsed/);
    await page.getByTestId('analysis-tab-histogram').click();
    await expect(dock).not.toHaveClass(/is-collapsed/);
    await expect(page.getByRole('separator', { name: '调整分析面板高度' })).toBeVisible();

    const defaultBox = await dock.boundingBox();
    const handleBox = await handle.boundingBox();
    expect(defaultBox).not.toBeNull();
    expect(handleBox).not.toBeNull();
    const canvasHeight = await viewportHeight();
    const x = handleBox!.x + handleBox!.width / 2;
    const y = handleBox!.y + handleBox!.height / 2;

    // Drag upward: the dock grows and the canvas viewport shrinks.
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x, y - 100, { steps: 10 });
    await page.mouse.up();
    const enlarged = await dock.boundingBox();
    expect(enlarged!.height).toBeGreaterThan(defaultBox!.height + 60);
    await expect.poll(viewportHeight, { timeout: 5_000 }).toBeLessThan(canvasHeight);

    // Keyboard resize and Enter reset.
    await handle.focus();
    await page.keyboard.press('ArrowDown');
    await expect.poll(async () => (await dock.boundingBox())!.height, { timeout: 5_000 }).toBeLessThan(enlarged!.height);
    await page.keyboard.press('Enter');
    await expect.poll(async () => Math.round((await dock.boundingBox())!.height), { timeout: 5_000 }).toBe(Math.round(defaultBox!.height));

    // Dragging downward is bounded by the minimum height; double-click restores the default.
    const resetBox = await handle.boundingBox();
    await page.mouse.move(resetBox!.x + resetBox!.width / 2, resetBox!.y + resetBox!.height / 2);
    await page.mouse.down();
    await page.mouse.move(resetBox!.x + resetBox!.width / 2, resetBox!.y + 150, { steps: 10 });
    await page.mouse.up();
    const shrunk = await dock.boundingBox();
    expect(shrunk!.height).toBeGreaterThanOrEqual(160);
    expect(shrunk!.height).toBeLessThan(defaultBox!.height);
    await handle.dblclick();
    await expect.poll(async () => Math.round((await dock.boundingBox())!.height), { timeout: 5_000 }).toBe(Math.round(defaultBox!.height));

    // Collapsing hides the handle; the dock returns to its 32px toolbar height.
    await page.locator('.analysis-collapse').click();
    await expect(dock).toHaveClass(/is-collapsed/);
    await expect(handle).toHaveCount(0);
  });

  test('hover readout appears in the left rail and status bar', async ({ page }) => {
    const host = page.locator('.canvas-host').first();
    const box = await host.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + box!.width * 0.5, box!.y + box!.height * 0.5);
    const panel = page.getByTestId('probe-panel');
    await expect(panel).toBeVisible({ timeout: 10_000 });
    await expect(panel).toContainText(/RAW [RG]/);
    await expect(panel).toContainText('WB');
    await expect(panel).toContainText('RGB');
    await expect(page.getByTestId('probe-inline')).toContainText('RGB');

    const center = await panel.innerText();
    await page.mouse.move(box!.x + box!.width * 0.62, box!.y + box!.height * 0.4);
    await expect.poll(async () => panel.innerText(), { timeout: 10_000 }).not.toBe(center);

    // The readout must not sit on top of the canvas.
    await expect(host.locator('[data-testid="probe-panel"], [data-testid="probe-inline"]')).toHaveCount(0);
  });
});
