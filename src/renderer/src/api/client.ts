import { ApiError, messageFromErrorResponseBody } from './api-error';

let baseUrl: string | null = null;
let initPromise: Promise<string> | null = null;

export async function resolveBaseUrl(): Promise<string> {
  if (baseUrl) return baseUrl;
  if (!initPromise) {
    initPromise = window.electronAPI.getBackendPort().then((port) => {
      baseUrl = `http://127.0.0.1:${port}`;
      return baseUrl;
    });
  }
  return initPromise;
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T | undefined> {
  const url = (await resolveBaseUrl()) + path;
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    const detail = messageFromErrorResponseBody(text);
    throw new ApiError(res.status, detail || `Something went wrong (${res.status}).`, text);
  }
  if (res.status === 204) return undefined;
  return (await res.json()) as T;
}

export const api = {
  get: <T>(path: string) => request<T>('GET', path) as Promise<T>,
  post: <T>(path: string, body?: unknown) =>
    request<T>('POST', path, body ?? {}) as Promise<T>,
  put: <T>(path: string, body: unknown) => request<T>('PUT', path, body) as Promise<T>,
  patch: <T>(path: string, body: unknown) => request<T>('PATCH', path, body) as Promise<T>,
  del: (path: string) => request<void>('DELETE', path) as Promise<void>,
  baseUrl: resolveBaseUrl,
};
