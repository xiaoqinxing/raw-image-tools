/// <reference lib="webworker" />

import type { BareRawConfig, FlatField } from '../core/types';
import { decodeBareRaw, RawDecodeError } from '../core/raw/bare';
import { decodeDng, initializeLibRaw } from '../core/raw/libraw';
import { computeFlatStats } from '../core/pipeline/cpu';
import { sha256Hex } from '../core/util/id';

type DecodeRequest =
  | { type: 'decodeDng'; requestId: string; buffer: ArrayBuffer; fileName: string; fileSize: number; flat?: boolean }
  | { type: 'decodeBare'; requestId: string; buffer: ArrayBuffer; fileName: string; fileSize: number; config: BareRawConfig; flat?: boolean };

let wasmBuffer: Promise<ArrayBuffer> | null = null;

async function ensureWasm(): Promise<ArrayBuffer> {
  if (!wasmBuffer) {
    const url = `${import.meta.env.BASE_URL}libraw/libraw.wasm`;
    wasmBuffer = fetch(url).then((r) => {
      if (!r.ok) throw new Error(`无法加载 LibRaw WASM（${r.status}）`);
      return r.arrayBuffer();
    });
  }
  return wasmBuffer;
}

function transferablesForRaw(raw: { data: Uint16Array }): Transferable[] {
  return raw.data?.buffer ? [raw.data.buffer] : [];
}

self.onmessage = async (event: MessageEvent<DecodeRequest>) => {
  const msg = event.data;
  const started = performance.now();
  try {
    const sha256 = await sha256Hex(msg.buffer);
    if (msg.type === 'decodeDng') {
      await initializeLibRaw(await ensureWasm());
      const raw = await decodeDng(msg.buffer, {
        fileName: msg.fileName,
        fileSize: msg.fileSize,
        sha256,
        wasm: await ensureWasm(),
      });
      if (msg.flat) {
        const flat: FlatField = {
          id: raw.id,
          fileName: raw.fileName,
          fileSize: raw.fileSize,
          sha256: raw.sha256,
          raw,
          compatibility: {
            sameGeometry: true,
            sameCfa: true,
            sameBitDepth: true,
            sameActiveArea: true,
          },
          stats: computeFlatStats(raw),
        };
        self.postMessage(
          { type: 'decodedFlat', requestId: msg.requestId, flat, decodeMs: performance.now() - started },
          transferablesForRaw(raw),
        );
      } else {
        self.postMessage(
          { type: 'decodedRaw', requestId: msg.requestId, raw, decodeMs: performance.now() - started },
          transferablesForRaw(raw),
        );
      }
      return;
    }
    if (msg.type === 'decodeBare') {
      const raw = decodeBareRaw(msg.buffer, msg.config);
      raw.fileName = msg.fileName;
      raw.fileSize = msg.fileSize;
      raw.sha256 = sha256;
      if (msg.flat) {
        const flat: FlatField = {
          id: raw.id,
          fileName: raw.fileName,
          fileSize: raw.fileSize,
          sha256: raw.sha256,
          raw,
          compatibility: {
            sameGeometry: true,
            sameCfa: true,
            sameBitDepth: true,
            sameActiveArea: true,
          },
          stats: computeFlatStats(raw),
        };
        self.postMessage(
          { type: 'decodedFlat', requestId: msg.requestId, flat, decodeMs: performance.now() - started },
          transferablesForRaw(raw),
        );
      } else {
        self.postMessage(
          { type: 'decodedRaw', requestId: msg.requestId, raw, decodeMs: performance.now() - started },
          transferablesForRaw(raw),
        );
      }
      return;
    }
  } catch (e) {
    const err = e as Error;
    self.postMessage({
      type: 'decodeError',
      requestId: msg.requestId,
      code: e instanceof RawDecodeError ? e.code : 'DECODE_FAILED',
      message: err.message,
      details: e instanceof RawDecodeError ? e.details : undefined,
      decodeMs: performance.now() - started,
    });
  }
};

export {};
