import type { RawImage } from '../types';
import { cfaChannelAt } from './cfa';

/**
 * Downscale a raw image for preview/full-resource-limited rendering while
 * preserving the 2x2 CFA phase. Factor must be even. Values of the same CFA
 * channel inside each factor x factor block are averaged.
 */
export function scaleRaw(raw: RawImage, factor: number): RawImage {
  if (factor <= 1) return raw;
  const f = Math.max(2, Math.round(factor / 2) * 2);
  const { active, storedWidth } = raw.geometry;
  const outW = Math.max(1, Math.ceil(active.w / f));
  const outH = Math.max(1, Math.ceil(active.h / f));
  const out = new Uint16Array(outW * outH);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const ch = cfaChannelAt(raw.cfa, x, y);
      let sum = 0;
      let n = 0;
      for (let dy = 0; dy < f; dy++) {
        const sy = y * f + dy;
        if (sy >= active.h) break;
        for (let dx = 0; dx < f; dx++) {
          const sx = x * f + dx;
          if (sx >= active.w) break;
          // Keep the same CFA channel only.
          if (cfaChannelAt(raw.cfa, sx, sy) !== ch) continue;
          sum += raw.data[(active.y + sy) * storedWidth + active.x + sx];
          n++;
        }
      }
      out[y * outW + x] = n ? Math.round(sum / n) : 0;
    }
  }
  return {
    ...raw,
    id: `${raw.id}:s${f}`,
    geometry: {
      ...raw.geometry,
      storedWidth: outW,
      storedHeight: outH,
      rowStrideBytes: outW * 2,
      active: { x: 0, y: 0, w: outW, h: outH },
    },
    data: out,
  };
}

export function previewFactor(width: number, height: number, maxEdge = 2048): number {
  const need = Math.max(width, height) / maxEdge;
  if (need <= 1) return 1;
  return Math.max(2, Math.ceil(need / 2) * 2);
}

export function resourceFactor(width: number, height: number, maxPixels: number, maxTexture: number): number {
  const edgeNeed = Math.max(width / maxTexture, height / maxTexture);
  const pixelNeed = Math.sqrt((width * height) / maxPixels);
  const need = Math.max(edgeNeed, pixelNeed);
  if (need <= 1) return 1;
  return Math.max(2, Math.ceil(need / 2) * 2);
}
