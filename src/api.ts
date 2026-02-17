import type { DiffDataResponse } from './types';

export async function fetchDiffData(): Promise<DiffDataResponse> {
  const response = await fetch('/api/diff-data');
  if (!response.ok) {
    throw new Error(`Failed to fetch data (${response.status})`);
  }
  return (await response.json()) as DiffDataResponse;
}

export async function fetchMetaForgeDiffData(): Promise<DiffDataResponse> {
  const response = await fetch('/api/metaforge-data');
  if (!response.ok) {
    throw new Error(`Failed to fetch MetaForge data (${response.status})`);
  }
  return (await response.json()) as DiffDataResponse;
}
