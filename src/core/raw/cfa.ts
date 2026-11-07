import type { ChannelId, CfaLayout, CfaPattern, Point, RawGeometry } from '../types';

export const CHANNEL_IDS: ChannelId[] = ['R', 'G1', 'G2', 'B'];

export function channelIndex(id: ChannelId): number {
  return CHANNEL_IDS.indexOf(id);
}

const PATTERN_SITES: Record<CfaPattern, [ChannelId, ChannelId, ChannelId, ChannelId]> = {
  RGGB: ['R', 'G1', 'G2', 'B'],
  BGGR: ['B', 'G2', 'G1', 'R'],
  GRBG: ['G1', 'R', 'B', 'G2'],
  GBRG: ['G2', 'B', 'R', 'G1'],
};

const SITE_CHANNELS: Record<CfaPattern, [number, number, number, number]> = {
  RGGB: [0, 1, 2, 3],
  BGGR: [3, 2, 1, 0],
  GRBG: [1, 0, 3, 2],
  GBRG: [2, 3, 0, 1],
};

/**
 * Build the CFA layout for the *active* area. The supplied pattern is the
 * pattern at the stored origin; origin is the active area origin in stored
 * coordinates. An odd origin shifts the effective 2x2 phase.
 */
export function makeCfaLayout(pattern: CfaPattern, origin: Point = { x: 0, y: 0 }): CfaLayout {
  const base = PATTERN_SITES[pattern];
  const px = origin.x & 1;
  const py = origin.y & 1;
  const pick = (x: number, y: number): ChannelId => base[((y + py) & 1) * 2 + ((x + px) & 1)];
  const sites: [ChannelId, ChannelId, ChannelId, ChannelId] = [
    pick(0, 0),
    pick(1, 0),
    pick(0, 1),
    pick(1, 1),
  ];
  return {
    pattern,
    sites,
    phaseOrigin: { x: origin.x, y: origin.y },
    siteChannels: [
      channelIndex(sites[0]),
      channelIndex(sites[1]),
      channelIndex(sites[2]),
      channelIndex(sites[3]),
    ],
  };
}

export function cfaAt(cfa: CfaLayout, x: number, y: number): ChannelId {
  return cfa.sites[(y & 1) * 2 + (x & 1)];
}

export function cfaChannelAt(cfa: CfaLayout, x: number, y: number): number {
  return cfa.siteChannels[(y & 1) * 2 + (x & 1)];
}

/** Effective pattern string, both greens rendered as "G". */
export function effectivePattern(cfa: CfaLayout): string {
  return cfa.sites.map((c) => (c === 'G1' || c === 'G2' ? 'G' : c)).join('');
}

export function patternFromCdesc(cdesc: string): CfaPattern | null {
  // LibRaw cdesc is column-major? For a 2x2 Bayer sensor it returns e.g. "RGBG".
  // We accept the four channel characters and derive the top-left orientation
  // only when the layout is unambiguous.
  const s = cdesc.toUpperCase();
  if (s.length < 4) return null;
  const c = s.slice(0, 4);
  if (c === 'RGGB') return 'RGGB';
  if (c === 'BGGR') return 'BGGR';
  if (c === 'GRBG') return 'GRBG';
  if (c === 'GBRG') return 'GBRG';
  // LibRaw often reports RGBG for RGGB (row-major with G1/G2 collapsed).
  if (c === 'RGBG') return 'RGGB';
  if (c === 'GBRG') return 'GBRG';
  if (c === 'BGRG') return 'BGGR';
  if (c === 'GRGB') return 'GRBG';
  return null;
}

export function patternFromFilters(filters: number): CfaPattern | null {
  const f = filters >>> 0;
  if (f === 0x94949494) return 'RGGB';
  if (f === 0x61616161) return 'BGGR';
  if (f === 0x49494949) return 'GRBG';
  if (f === 0x16161616) return 'GBRG';
  if (f === 0xb4b4b4b4) return 'RGGB';
  if (f === 0x4b4b4b4b) return 'BGGR';
  if (f === 0x1b1b1b1b) return 'GRBG';
  if (f === 0xb1b1b1b1) return 'GBRG';
  return null;
}

export function cfaPhaseAtActive(geometry: RawGeometry): Point {
  return { x: geometry.active.x, y: geometry.active.y };
}

export function isGreen(c: ChannelId): boolean {
  return c === 'G1' || c === 'G2';
}

export function cfaStringFromSites(pattern: CfaPattern): string {
  return PATTERN_SITES[pattern].join('');
}

export function sameCfa(a: CfaLayout, b: CfaLayout): boolean {
  return a.sites.join(',') === b.sites.join(',') && a.phaseOrigin.x === b.phaseOrigin.x && a.phaseOrigin.y === b.phaseOrigin.y;
}
