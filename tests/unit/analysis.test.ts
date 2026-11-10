import { describe, expect, it } from 'vitest';
import { computeHistogram } from '../../src/core/analysis/histogram';
import { computeSnr } from '../../src/core/analysis/snr';
import { computeMtf } from '../../src/core/analysis/mtf';
import { computeNoiseSpectrum } from '../../src/core/analysis/noise';
import { computeDiff } from '../../src/core/analysis/diff';
import { fitCcm } from '../../src/core/color/ccm';
import { linearSrgbToLab, srgbDecode, srgbEncode } from '../../src/core/color/lab';
import { COLOR_CHECKER_CLASSIC_24 } from '../../src/core/color/colorchecker-data';

function rgba(w: number, h: number, fn: (x: number, y: number) => [number, number, number, number]): Float32Array {
  const out = new Float32Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const v = fn(x, y);
    const i = (y * w + x) * 4;
    out[i] = v[0]; out[i + 1] = v[1]; out[i + 2] = v[2]; out[i + 3] = v[3];
  }
  return out;
}

describe('analysis', () => {
  it('histogram counts a constant image', () => {
    const data = rgba(16, 16, () => [0.5, 0.5, 0.5, 1]);
    const h = computeHistogram({ width: 16, height: 16, data, bins: 256, domain: 'display-srgb' });
    expect(h.total).toBe(256);
    expect(h.channels.r[128]).toBe(256);
    expect(h.mean).toBeCloseTo(0.5, 5);
  });

  it('reports R/G/B means and green-normalized ratios for the analysed area', () => {
    const data = rgba(8, 8, () => [0.5, 0.25, 0.1, 1]);
    const h = computeHistogram({ width: 8, height: 8, data, bins: 256, domain: 'display-srgb' });
    expect(h.channelMeans[0]).toBeCloseTo(0.5, 6);
    expect(h.channelMeans[1]).toBeCloseTo(0.25, 6);
    expect(h.channelMeans[2]).toBeCloseTo(0.1, 6);
    expect(h.channelRatios[0]).toBeCloseTo(2, 6);
    expect(h.channelRatios[1]).toBe(1);
    expect(h.channelRatios[2]).toBeCloseTo(0.4, 6);
  });

  it('SNR matches synthetic Gaussian noise within 0.2 dB', () => {
    let seed = 12345;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const mean = 0.4;
    const std = 0.004;
    const data = rgba(128, 128, () => {
      const n = Math.sqrt(-2 * Math.log(Math.max(1e-9, rand()))) * Math.cos(2 * Math.PI * rand());
      const v = mean + n * std;
      return [v, v, v, 1];
    });
    const r = computeSnr({ width: 128, height: 128, data, rect: { x: 0, y: 0, w: 128, h: 128 }, domain: 'linear-srgb' });
    const y = r.perChannel[3];
    expect(y.snrDb).toBeCloseTo(20 * Math.log10(mean / std), 0);
    expect(Math.abs(y.snrDb - 20 * Math.log10(mean / std))).toBeLessThan(0.2);
  });

  it('MTF50 of a Gaussian-blurred slanted edge is within 5%', () => {
    const w = 256, h = 128;
    // Edge slanted by ~5 degrees. Convolve a hard edge with a Gaussian along
    // the normal, using an error function approximation.
    const sigma = 1.5;
    const slope = 0.09;
    const erf = (x: number) => {
      const t = 1 / (1 + 0.3275911 * Math.abs(x));
      const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
      return x >= 0 ? y : -y;
    };
    const data = rgba(w, h, (x, y) => {
      const d = (x - (w / 2 + slope * (y - h / 2))) / sigma;
      const v = 0.1 + 0.8 * 0.5 * (1 + erf(d / Math.SQRT2));
      return [v, v, v, 1];
    });
    const r = computeMtf({ width: w, height: h, data, rect: { x: 20, y: 10, w: 216, h: 108 }, domain: 'linear-srgb' });
    const expected = Math.sqrt(Math.log(2) / (2 * Math.PI * Math.PI * sigma * sigma));
    const y = r.perChannel[3];
    expect(Math.abs(y.mtf50 - expected) / expected).toBeLessThan(0.05);
  });

  it('noise spectrum of white noise is approximately flat', () => {
    let seed = 7;
    const rand = () => { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 0x100000000; };
    const data = rgba(128, 128, () => {
      const v = 0.5 + (rand() - 0.5) * 0.02;
      return [v, v, v, 1];
    });
    const n = computeNoiseSpectrum({ width: 128, height: 128, data, rect: { x: 0, y: 0, w: 128, h: 128 }, domain: 'linear-srgb', channel: 3 });
    // Compare inner radial bins; exclude DC and the highest-frequency corners.
    const vals = n.radial.slice(8, 40).map((p) => p.power);
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    expect(mean).toBeGreaterThan(0);
    const rel = Math.max(...vals.map((v) => Math.abs(v - mean) / mean));
    expect(rel).toBeLessThan(0.65);
  });

  it('diff encodes B with its own stage domain', () => {
    const a = rgba(1, 1, () => [0.5, 0.5, 0.5, 1]);
    const b = rgba(1, 1, () => [0.5, 0.5, 0.5, 1]);
    const d = computeDiff({
      width: 1,
      height: 1,
      a,
      b,
      domain: 'display-srgb',
      domainB: 'linear-srgb',
      gain: 1,
      signed: false,
    });
    expect(d.metrics.mae).toBeCloseTo(Math.abs(0.5 - srgbEncode(0.5)), 5);
  });

  it('CCM least squares recovers a known matrix', () => {
    const known = [0.9, 0.08, 0.02, 0.05, 0.92, 0.03, 0.02, 0.06, 0.92] as const;
    const patches = COLOR_CHECKER_CLASSIC_24;
    const camera: Array<[number, number, number]> = patches.map((p, i) => {
      // Construct a camera sample such that known * camera = reference linear.
      const ref = p.srgb.map((v) => srgbDecode(v / 255)) as [number, number, number];
      // Use a simple deterministic approximate inverse (known is near identity).
      const inv = [1.1, -0.09, -0.02, -0.06, 1.08, -0.03, -0.02, -0.07, 1.09];
      return [
        Math.max(0.001, inv[0] * ref[0] + inv[1] * ref[1] + inv[2] * ref[2] + (i % 3) * 0.0001),
        Math.max(0.001, inv[3] * ref[0] + inv[4] * ref[1] + inv[5] * ref[2] + (i % 5) * 0.0001),
        Math.max(0.001, inv[6] * ref[0] + inv[7] * ref[1] + inv[8] * ref[2] + (i % 7) * 0.0001),
      ];
    });
    const reference = patches.map((p) => p.srgb.map((v) => srgbDecode(v / 255)) as [number, number, number]);
    const fit = fitCcm({ camera, referenceSrgb: reference, patches });
    expect(fit.meanDE00).toBeLessThan(1.0);
    expect(fit.maxDE00).toBeLessThan(3.0);
  });
});
