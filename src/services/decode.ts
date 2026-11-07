import type { BareRawConfig, FlatField, RawImage } from '../core/types';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

type DecodeEvent =
  | { type: 'decodedRaw'; requestId: string; raw: RawImage; decodeMs: number }
  | { type: 'decodedFlat'; requestId: string; flat: FlatField; decodeMs: number }
  | { type: 'decodeError'; requestId: string; code: string; message: string; details?: unknown; decodeMs: number };

export class DecodeError extends Error {
  constructor(readonly code: string, message: string, readonly details?: unknown) {
    super(message);
    this.name = 'DecodeError';
  }
}

export class DecodeService {
  private worker: Worker;
  private seq = 0;
  private pending = new Map<string, Pending>();

  constructor() {
    this.worker = new Worker(new URL('../workers/decode.worker.ts', import.meta.url), { type: 'module' });
    this.worker.onmessage = (e: MessageEvent<DecodeEvent>) => {
      const msg = e.data;
      const p = this.pending.get(msg.requestId);
      if (!p) return;
      this.pending.delete(msg.requestId);
      if (msg.type === 'decodeError') {
        p.reject(new DecodeError(msg.code, msg.message, msg.details));
      } else if (msg.type === 'decodedRaw') {
        p.resolve({ raw: msg.raw, decodeMs: msg.decodeMs });
      } else {
        p.resolve({ flat: msg.flat, decodeMs: msg.decodeMs });
      }
    };
    this.worker.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(`解码 Worker 错误：${e.message}`));
      this.pending.clear();
    };
  }

  private send(msg: Record<string, unknown>, transfer: Transferable[]): Promise<unknown> {
    const requestId = `d${++this.seq}`;
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      this.worker.postMessage({ ...msg, requestId }, transfer);
    });
  }

  async decodeDng(file: File): Promise<{ raw: RawImage; decodeMs: number }> {
    const buffer = await file.arrayBuffer();
    return (await this.send(
      { type: 'decodeDng', buffer, fileName: file.name, fileSize: file.size },
      [buffer],
    )) as { raw: RawImage; decodeMs: number };
  }

  async decodeBare(file: File, config: BareRawConfig): Promise<{ raw: RawImage; decodeMs: number }> {
    const buffer = await file.arrayBuffer();
    return (await this.send(
      { type: 'decodeBare', buffer, fileName: file.name, fileSize: file.size, config },
      [buffer],
    )) as { raw: RawImage; decodeMs: number };
  }

  async decodeFlatDng(file: File): Promise<{ flat: FlatField; decodeMs: number }> {
    const buffer = await file.arrayBuffer();
    return (await this.send(
      { type: 'decodeDng', buffer, fileName: file.name, fileSize: file.size, flat: true },
      [buffer],
    )) as { flat: FlatField; decodeMs: number };
  }

  async decodeFlatBare(file: File, config: BareRawConfig): Promise<{ flat: FlatField; decodeMs: number }> {
    const buffer = await file.arrayBuffer();
    return (await this.send(
      { type: 'decodeBare', buffer, fileName: file.name, fileSize: file.size, config, flat: true },
      [buffer],
    )) as { flat: FlatField; decodeMs: number };
  }

  destroy(): void {
    this.worker.terminate();
    this.pending.clear();
  }
}

export const decodeService = new DecodeService();
