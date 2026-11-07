let fallbackCounter = 0;

export function uid(prefix = ''): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') {
    return prefix + c.randomUUID();
  }
  fallbackCounter += 1;
  return `${prefix}${Date.now().toString(36)}-${fallbackCounter.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function sha256Hex(buffer: ArrayBuffer): Promise<string> {
  const c = globalThis.crypto;
  if (!c?.subtle) {
    // Node 18 without global WebCrypto: use a deterministic non-crypto fallback
    // only for tests/dev. The worker always has WebCrypto in Chrome.
    const bytes = new Uint8Array(buffer);
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193;
    for (const b of bytes) {
      h1 = Math.imul(h1 ^ b, 0x01000193);
      h2 = Math.imul(h2 + b, 0x85ebca6b);
    }
    return `fnv-${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`;
  }
  const digest = await c.subtle.digest('SHA-256', buffer);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}
