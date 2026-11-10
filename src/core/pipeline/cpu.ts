import type { CfaLayout, FlatField, PipelineParams, RawImage, Vec4 } from '../types';
import { cfaChannelAt, makeCfaLayout } from '../raw/cfa';
import type { CfaPlane } from '../demosaic/cpu';

export function extractCfaPlane(raw: RawImage): CfaPlane {
  const { active, storedWidth } = raw.geometry;
  const data = new Float32Array(active.w * active.h);
  for (let y = 0; y < active.h; y++) {
    const row = (active.y + y) * storedWidth + active.x;
    for (let x = 0; x < active.w; x++) {
      data[y * active.w + x] = raw.data[row + x];
    }
  }
  return { width: active.w, height: active.h, data, cfa: raw.cfa };
}

export function applyLevelsFlatWb(
  raw: RawImage,
  params: PipelineParams,
  flat?: FlatField | null,
): CfaPlane {
  const { active, storedWidth } = raw.geometry;
  const data = new Float32Array(active.w * active.h);
  const black = params.levels.black;
  const white = params.levels.white;
  const wb = params.wb.multipliers;
  const flatEnabled = !params.flat.bypass && !!flat && flat.compatibility.sameActiveArea;
  const flatRaw = flat?.raw;
  const flatBlack = flatRaw?.levels.black ?? ([0, 0, 0, 0] as Vec4);
  const flatWhite = flatRaw?.levels.white ?? ([1, 1, 1, 1] as Vec4);
  const flatMeans = flat?.stats.means ?? ([1, 1, 1, 1] as Vec4);
  const strength = Math.max(0, Math.min(1, params.flat.strength / 100));
  const eps = params.flat.epsilon;
  const maxGain = params.flat.maxGain;
  const flatGeometry = flatRaw?.geometry;
  for (let y = 0; y < active.h; y++) {
    const row = (active.y + y) * storedWidth + active.x;
    for (let x = 0; x < active.w; x++) {
      const ch = cfaChannelAt(raw.cfa, x, y);
      const d = raw.data[row + x];
      let v = (d - black[ch]) / Math.max(1e-9, white[ch] - black[ch]);
      if (params.levels.clampNegative) v = Math.max(0, v);
      if (flatEnabled && flatRaw && flatGeometry) {
        const fRow = (flatGeometry.active.y + y) * flatGeometry.storedWidth + flatGeometry.active.x + x;
        const fd = flatRaw.data[fRow];
        const f = (fd - flatBlack[ch]) / Math.max(1e-9, flatWhite[ch] - flatBlack[ch]);
        let gain = 1;
        if (f > eps) {
          gain = Math.min(maxGain, Math.max(1 / maxGain, flatMeans[ch] / f));
          // Normalize green gain to 1. Flat means are normalized so this is
          // already close to 1, but the reciprocal makes the average slightly
          // different; the scalar below is computed from the flat means.
        }
        const gRef = (flatMeans[1] + flatMeans[2]) / 2 || 1;
        gain /= gRef;
        const applied = 1 + strength * (gain - 1);
        v *= applied;
      }
      if (!params.wb.bypass) v *= wb[ch] ?? 1;
      if (!params.digitalGain.bypass) v *= params.digitalGain.global;
      data[y * active.w + x] = v;
    }
  }
  return { width: active.w, height: active.h, data, cfa: raw.cfa };
}

export function computeFlatStats(raw: RawImage): FlatField['stats'] {
  const { active, storedWidth } = raw.geometry;
  const sums = [0, 0, 0, 0];
  const counts = [0, 0, 0, 0];
  const valid = [0, 0, 0, 0];
  const clipped = [0, 0, 0, 0];
  const maxGain = [1, 1, 1, 1];
  for (let y = 0; y < active.h; y++) {
    const row = (active.y + y) * storedWidth + active.x;
    for (let x = 0; x < active.w; x++) {
      const ch = cfaChannelAt(raw.cfa, x, y);
      const f = (raw.data[row + x] - raw.levels.black[ch]) / Math.max(1e-9, raw.levels.white[ch] - raw.levels.black[ch]);
      counts[ch]++;
      if (f > 1e-4 && f < 0.999) {
        sums[ch] += f;
        valid[ch]++;
      }
      if (f >= 0.999) clipped[ch]++;
    }
  }
  const means = sums.map((s, i) => (valid[i] ? s / valid[i] : 1)) as Vec4;
  const gRef = (means[1] + means[2]) / 2 || 1;
  const normalized = means.map((m) => m / gRef) as Vec4;
  return {
    means: normalized,
    validFraction: counts.map((c, i) => (c ? valid[i] / c : 0)) as Vec4,
    clippedFraction: counts.map((c, i) => (c ? clipped[i] / c : 0)) as Vec4,
    maxGain: maxGain as Vec4,
  };
}

export function rawSampleAt(raw: RawImage, x: number, y: number): { dn: number; channel: number; normalized: number } {
  const { active, storedWidth } = raw.geometry;
  const ax = Math.max(0, Math.min(active.w - 1, Math.round(x)));
  const ay = Math.max(0, Math.min(active.h - 1, Math.round(y)));
  const ch = cfaChannelAt(raw.cfa, ax, ay);
  const dn = raw.data[(active.y + ay) * storedWidth + active.x + ax];
  const normalized = (dn - raw.levels.black[ch]) / Math.max(1e-9, raw.levels.white[ch] - raw.levels.black[ch]);
  return { dn, channel: ch, normalized };
}

export function flatForRaw(flat: FlatField, raw: RawImage): boolean {
  return flat.compatibility.sameGeometry && flat.compatibility.sameCfa && flat.compatibility.sameBitDepth && flat.compatibility.sameActiveArea;
}

export function makeCfaForFlat(raw: RawImage, flatRaw: RawImage): CfaLayout {
  return makeCfaLayout(flatRaw.cfa.pattern, flatRaw.cfa.phaseOrigin);
}
