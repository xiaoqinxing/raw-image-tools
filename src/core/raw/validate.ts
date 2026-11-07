import type { CfaLayout, ChannelId, RawDiagnostics, RawGeometry, RawLevels } from '../types';
import { cfaAt, CHANNEL_IDS } from './cfa';

const HIST_BINS = 65536;

export function analyzeRaw(
  data: Uint16Array,
  geometry: RawGeometry,
  cfa: CfaLayout,
  levels: RawLevels,
  actualBytes: number,
  layout: { rowBytes: number; headerOffset: number; rowStride: number },
): RawDiagnostics {
  const { active } = geometry;
  const pixelCount = active.w * active.h;
  const step = pixelCount > 8_000_000 ? Math.ceil(pixelCount / 8_000_000) : 1;
  const hists = Array.from({ length: 4 }, () => new Uint32Array(HIST_BINS));
  const mins = [Infinity, Infinity, Infinity, Infinity];
  const maxs = [-Infinity, -Infinity, -Infinity, -Infinity];
  const belowByCh = [0, 0, 0, 0];
  const aboveByCh = [0, 0, 0, 0];
  const totalByCh = [0, 0, 0, 0];
  let sampled = 0;

  for (let y = 0; y < active.h; y++) {
    const row = (active.y + y) * geometry.storedWidth + active.x;
    for (let x = 0; x < active.w; x += step) {
      const v = data[row + x];
      const ch = cfa.siteChannels[(y & 1) * 2 + (x & 1)];
      if (v < mins[ch]) mins[ch] = v;
      if (v > maxs[ch]) maxs[ch] = v;
      hists[ch][Math.min(HIST_BINS - 1, v)]++;
      if (v < levels.black[ch]) belowByCh[ch]++;
      if (v > levels.white[ch]) aboveByCh[ch]++;
      totalByCh[ch]++;
      sampled++;
    }
  }
  const belowBlack = belowByCh.reduce((a, b) => a + b, 0);
  const aboveWhite = aboveByCh.reduce((a, b) => a + b, 0);

  const perChannel = CHANNEL_IDS.map((channel, ch) => {
    const hist = hists[ch];
    const total = hist.reduce((a, b) => a + b, 0);
    const at = (q: number) => {
      if (total === 0) return 0;
      const target = Math.max(0, Math.min(total - 1, Math.floor(q * (total - 1))));
      let acc = 0;
      for (let i = 0; i < hist.length; i++) {
        acc += hist[i];
        if (acc > target) return i;
      }
      return hist.length - 1;
    };
    return {
      channel,
      min: Number.isFinite(mins[ch]) ? mins[ch] : 0,
      p1: at(0.01),
      p50: at(0.5),
      p99: at(0.99),
      max: Number.isFinite(maxs[ch]) ? maxs[ch] : 0,
      belowBlack: total ? belowByCh[ch] / Math.max(1, totalByCh[ch]) : 0,
      aboveWhite: total ? aboveByCh[ch] / Math.max(1, totalByCh[ch]) : 0,
    };
  });

  const mean = (ch: number) => {
    let sum = 0;
    let n = 0;
    const hist = hists[ch];
    for (let i = 0; i < hist.length; i++) {
      sum += i * hist[i];
      n += hist[i];
    }
    return n ? sum / n : 0;
  };
  const mG1 = mean(1);
  const mG2 = mean(2);
  const greenDiff = mG1 + mG2 > 0 ? Math.abs(mG1 - mG2) / (mG1 + mG2) : 0;
  const cfaConsistency = Math.max(0, 1 - greenDiff * 2);

  const warnings: RawDiagnostics['warnings'] = [];
  const suggestions: RawDiagnostics['suggestions'] = [];
  if (actualBytes < layout.headerOffset + layout.rowStride * (geometry.storedHeight - 1) + layout.rowBytes) {
    warnings.push({ level: 'error', message: '文件长度不足以容纳按当前 stride 解码的完整帧。' });
  }
  if (belowBlack / Math.max(1, sampled) > 0.01) {
    warnings.push({
      level: 'warn',
      message: `约有 ${(100 * belowBlack / Math.max(1, sampled)).toFixed(2)}% 样本低于黑电平，可能 black level 偏高或 offset/stride 有误。`,
    });
  }
  if (aboveWhite / Math.max(1, sampled) > 0.02) {
    warnings.push({
      level: 'warn',
      message: `约有 ${(100 * aboveWhite / Math.max(1, sampled)).toFixed(2)}% 样本高于白电平，可能 white level 偏低或曝光过度。`,
    });
  }
  if (greenDiff > 0.03) {
    warnings.push({
      level: 'warn',
      message: `G1/G2 均值相差 ${(greenDiff * 100).toFixed(1)}%，CFA 排列、平场或白平衡可能不正确。`,
    });
  }
  if (perChannel.some((c) => c.max > (levels.white[0] ?? 65535) * 1.2)) {
    warnings.push({ level: 'warn', message: '样本最大值明显超过白电平，请检查位宽/对齐/packing。' });
  }

  const requiredBytes = layout.headerOffset + layout.rowStride * (geometry.storedHeight - 1) + layout.rowBytes;
  const bytesDelta = actualBytes - requiredBytes;
  if (bytesDelta < 0 && geometry.storedHeight > 1) {
    const maxStride = Math.floor((actualBytes - layout.headerOffset - layout.rowBytes) / (geometry.storedHeight - 1));
    if (maxStride >= layout.rowBytes) {
      suggestions.push({ kind: 'stride', value: maxStride, score: 0.9, label: `按文件长度反推 row stride ≈ ${maxStride} bytes` });
    }
    if (layout.headerOffset > 0) {
      suggestions.push({ kind: 'offset', value: 0, score: 0.7, label: '尝试 header offset = 0' });
    }
  }
  if (greenDiff > 0.03) {
    const alternates = (['RGGB', 'BGGR', 'GRBG', 'GBRG'] as const).filter((p) => {
      const site = cfa.sites[(0 & 1) * 2 + (0 & 1)];
      return p !== cfa.pattern && site !== undefined;
    });
    for (const p of alternates.slice(0, 2)) suggestions.push({ kind: 'cfa', value: p, score: 0.5, label: `CFA 候选：${p}` });
  }
  if (perChannel.some((c) => c.max > (levels.white[0] ?? 65535) * 1.2)) {
    suggestions.push({ kind: 'bitDepth', value: geometry.bitDepth, score: 0.4, label: '检查位宽、左/右对齐与 packing' });
  }
  return {
    requiredBytes,
    actualBytes,
    bytesDelta,
    perChannel,
    cfaConsistency,
    warnings,
    suggestions,
  };
}

export function channelName(ch: ChannelId): string {
  return ch;
}
