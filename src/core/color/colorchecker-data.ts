import type { Lab } from './lab';
import { srgb8ToLab } from './lab';

export interface ColorCheckerPatch {
  index: number;
  name: string;
  nameZh: string;
  srgb: [number, number, number];
  lab: Lab;
}

/**
 * ColorChecker Classic 24, pre-2014 X-Rite/GretagMacbeth sRGB values (D65).
 * Source: X-Rite ColorChecker data (2009), as reproduced in public tables.
 * Values are data; see THIRD_PARTY_NOTICES.md for attribution.
 * Layout: 6 columns x 4 rows, row-major.
 */
const PATCHES: Array<[string, string, [number, number, number]]> = [
  ['Dark skin', '深肤色', [115, 82, 68]],
  ['Light skin', '浅肤色', [194, 150, 130]],
  ['Blue sky', '蓝天', [98, 122, 157]],
  ['Foliage', '树叶', [87, 108, 67]],
  ['Blue flower', '蓝花', [133, 128, 177]],
  ['Bluish green', '蓝绿', [103, 189, 170]],

  ['Orange', '橙色', [214, 126, 44]],
  ['Purplish blue', '紫蓝', [80, 91, 166]],
  ['Moderate red', '中等红', [193, 90, 99]],
  ['Purple', '紫色', [94, 60, 108]],
  ['Yellow green', '黄绿', [157, 188, 64]],
  ['Orange yellow', '橙黄', [224, 163, 46]],

  ['Blue', '蓝色', [56, 61, 150]],
  ['Green', '绿色', [70, 148, 73]],
  ['Red', '红色', [175, 54, 60]],
  ['Yellow', '黄色', [231, 199, 31]],
  ['Magenta', '品红', [187, 86, 149]],
  ['Cyan', '青色', [8, 133, 161]],

  ['White 9.5', '白 9.5', [243, 243, 242]],
  ['Neutral 8', '中性 8', [200, 200, 200]],
  ['Neutral 6.5', '中性 6.5', [160, 160, 160]],
  ['Neutral 5', '中性 5', [122, 122, 121]],
  ['Neutral 3.5', '中性 3.5', [85, 85, 85]],
  ['Black 2', '黑 2', [52, 52, 52]],
];

export const COLOR_CHECKER_CLASSIC_24: ColorCheckerPatch[] = PATCHES.map(([name, nameZh, srgb], i) => ({
  index: i,
  name,
  nameZh,
  srgb,
  lab: srgb8ToLab(srgb[0], srgb[1], srgb[2]),
}));

export const COLOR_CHECKER_REFERENCES: Record<string, { id: string; label: string; patches: ColorCheckerPatch[] }> = {
  'classic24-pre2014-d65': {
    id: 'classic24-pre2014-d65',
    label: 'ColorChecker Classic 24（pre-2014, D65）',
    patches: COLOR_CHECKER_CLASSIC_24,
  },
};

export function getReference(id: string): ColorCheckerPatch[] {
  return COLOR_CHECKER_REFERENCES[id]?.patches ?? COLOR_CHECKER_CLASSIC_24;
}
