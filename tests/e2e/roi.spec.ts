import { test, expect } from '@playwright/test';
import path from 'node:path';

const fixture = path.resolve('tests/fixtures/test-gradient.dng');

type Rect = { x: number; y: number; w: number; h: number };

type DocState = {
  roi: Rect | null;
  tool: string;
  analysis: Record<string, { roi?: Rect | null } | undefined>;
};

function readDoc(page: import('@playwright/test').Page): Promise<DocState> {
  return page.evaluate(() => {
    const state = (window as unknown as { __rawlab: { useStore: { getState: () => { docs: Record<string, DocState & { id: string }>; activeId: string; tool: string } } } }).__rawlab.useStore.getState();
    const doc = state.docs[state.activeId];
    return { roi: doc.roi, tool: state.tool, analysis: doc.analysis };
  });
}

async function importFixture(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: '导入图像' }).first().click();
  await page.setInputFiles('.modal input[type=file]', fixture);
  await page.locator('.modal').getByRole('button', { name: '导入', exact: true }).click();
  await expect(page.getByText('test-gradient.dng').first()).toBeVisible({ timeout: 20_000 });
  await page.waitForTimeout(1200);
}

async function dragRoi(page: import('@playwright/test').Page, x0: number, y0: number, x1: number, y1: number) {
  const host = page.locator('.canvas-host').first();
  const box = await host.boundingBox();
  expect(box).toBeTruthy();
  await page.mouse.move(box!.x + box!.width * x0, box!.y + box!.height * y0);
  await page.mouse.down();
  await page.mouse.move(box!.x + box!.width * x1, box!.y + box!.height * y1, { steps: 6 });
  await page.mouse.up();
}

test('ROI-required analyses need a marquee; framing toggles and stays active', async ({ page }) => {
  await importFixture(page);
  const range = page.getByTestId('analysis-range');

  await page.locator('.analysis-collapse').click();

  // Waveform supports the full image by default and can be restricted later.
  await page.getByTestId('analysis-tab-waveform').click();
  await expect(range).toContainText('整幅图像');
  await expect.poll(async () => {
    const d = await readDoc(page);
    return d.analysis.waveform ?? null;
  }, { timeout: 15_000 }).not.toBeNull();
  expect((await readDoc(page)).analysis.waveform?.roi ?? null).toBeNull();

  for (const tab of ['snr', 'mtf', 'noise', 'diff'] as const) {
    await page.getByTestId(`analysis-tab-${tab}`).click();
    await expect(range).toContainText('尚未框选');
    const state = await readDoc(page);
    expect(state.analysis[tab] ?? null).toBeNull();
    expect(state.tool).toBe('pan');
  }

  // Clicking 框选 lights the toggle and enables the marquee.
  await page.getByTestId('analysis-tab-snr').click();
  await range.getByRole('button', { name: '框选' }).click();
  expect((await readDoc(page)).tool).toBe('roi');
  await dragRoi(page, 0.3, 0.3, 0.55, 0.55);

  await expect.poll(async () => (await readDoc(page)).roi, { timeout: 10_000 }).not.toBeNull();
  const first = await readDoc(page);
  expect(first.tool).toBe('roi');
  expect(first.roi!.w).toBeGreaterThan(2);
  expect(first.roi!.h).toBeGreaterThan(2);
  await expect.poll(async () => {
    const d = await readDoc(page);
    return d.analysis.snr?.roi ?? null;
  }, { timeout: 15_000 }).toEqual(first.roi);

  // The marquee stays active after a drag. Clicking 框选 again turns it off
  // without clearing the ROI; clicking once more resumes framing.
  await expect(range.getByRole('button', { name: '框选' })).toHaveClass(/btn-primary/);
  await range.getByRole('button', { name: '框选' }).click();
  expect((await readDoc(page)).tool).toBe('pan');
  expect((await readDoc(page)).roi).toEqual(first.roi);
  await range.getByRole('button', { name: '框选' }).click();
  expect((await readDoc(page)).tool).toBe('roi');

  await dragRoi(page, 0.2, 0.2, 0.45, 0.45);
  await expect.poll(async () => (await readDoc(page)).roi, { timeout: 10_000 }).not.toEqual(first.roi);
  const framed = await readDoc(page);
  expect(framed.tool).toBe('roi');
  await expect.poll(async () => {
    const d = await readDoc(page);
    return d.analysis.snr?.roi ?? null;
  }, { timeout: 15_000 }).toEqual(framed.roi);

  // Histogram is optional-ROI: it runs with the current ROI and falls back to
  // the full image after "全图".
  await page.getByTestId('analysis-tab-histogram').click();
  expect((await readDoc(page)).tool).toBe('pan');
  await expect.poll(async () => {
    const d = await readDoc(page);
    return d.analysis.histogram?.roi ?? null;
  }, { timeout: 15_000 }).toEqual(framed.roi);

  await range.getByRole('button', { name: '全图' }).click();
  await expect.poll(async () => (await readDoc(page)).roi, { timeout: 10_000 }).toBeNull();
  await expect.poll(async () => {
    const d = await readDoc(page);
    return d.analysis.histogram?.roi ?? null;
  }, { timeout: 15_000 }).toBeNull();

  // Clearing the ROI also invalidates the ROI-required results.
  await page.getByTestId('analysis-tab-snr').click();
  await expect(range).toContainText('尚未框选');
  expect((await readDoc(page)).analysis.snr ?? null).toBeNull();
});
