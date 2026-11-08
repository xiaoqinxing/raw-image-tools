import type { Rect } from '../types';

export interface RgbaPixels {
  width: number;
  height: number;
  data: Float32Array;
}

/**
 * Crop rendered RGBA pixels to an image-space ROI.
 *
 * When the current stage is raw CFA, the origin is aligned to even coordinates
 * so that Bayer parity (and therefore CFA channel lookup) stays correct.
 * `null` means the full image and returns the original buffer untouched.
 */
export function cropForAnalysis(
  pixels: RgbaPixels,
  roi: Rect | null,
  sx: number,
  sy: number,
  alignCfa: boolean,
): RgbaPixels {
  if (!roi) return pixels;
  let x0 = Math.max(0, Math.floor(roi.x * sx));
  let y0 = Math.max(0, Math.floor(roi.y * sy));
  let x1 = Math.min(pixels.width, Math.ceil((roi.x + roi.w) * sx));
  let y1 = Math.min(pixels.height, Math.ceil((roi.y + roi.h) * sy));
  if (alignCfa) {
    x0 &= ~1;
    y0 &= ~1;
    x1 = Math.min(pixels.width, Math.max(x1, x0 + 2));
    y1 = Math.min(pixels.height, Math.max(y1, y0 + 2));
  }
  const width = Math.max(1, x1 - x0);
  const height = Math.max(1, y1 - y0);
  const data = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    const start = ((y0 + y) * pixels.width + x0) * 4;
    data.set(pixels.data.subarray(start, start + width * 4), y * width * 4);
  }
  return { width, height, data };
}
