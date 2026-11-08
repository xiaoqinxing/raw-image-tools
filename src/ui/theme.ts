/**
 * Colour helpers for the dark workbench palette.
 *
 * Dependency-free on purpose: unit tests use them to assert that UI text keeps
 * a readable contrast ratio against the surfaces it is rendered on.
 */

export const MIN_TEXT_CONTRAST = 4.5;
export const MIN_PRIMARY_CONTRAST = 12;

function normalizeHex(hex: string): string {
  const raw = hex.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}$/i.test(raw)) {
    throw new Error(`expected a 6-digit hex colour, got "${hex}"`);
  }
  return raw.toLowerCase();
}

/** WCAG 2.1 relative luminance for an sRGB hex colour. */
export function relativeLuminance(hex: string): number {
  const value = normalizeHex(hex);
  const [r, g, b] = [0, 2, 4].map((offset) => {
    const channel = parseInt(value.slice(offset, offset + 2), 16) / 255;
    return channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.1 contrast ratio between two opaque sRGB colours (1..21). */
export function contrastRatio(a: string, b: string): number {
  const [high, low] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (high + 0.05) / (low + 0.05);
}
