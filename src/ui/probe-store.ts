import { useSyncExternalStore } from 'react';
import type { ProbeSample } from '../core/types';

let current: ProbeSample | null = null;
const listeners = new Set<() => void>();

export function setProbeSample(sample: ProbeSample | null): void {
  if (sample === current) return;
  current = sample;
  for (const listener of listeners) listener();
}

export function getProbeSample(): ProbeSample | null {
  return current;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Live hover sample with minimal re-render scope. */
export function useProbeSample(): ProbeSample | null {
  return useSyncExternalStore(subscribe, getProbeSample, getProbeSample);
}
