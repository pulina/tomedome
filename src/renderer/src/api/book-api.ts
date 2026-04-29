import { ApiError, messageFromErrorResponseBody } from './api-error';
import { api, resolveBaseUrl } from './client';
import type { Abstract, Book, BookStats, ChunkingOptions, EmbeddingSearchResult, ImportResult, Job } from '../../../shared/types';

export type ZipImportSource =
  | { kind: 'file'; file: File }
  | { kind: 'path'; path: string };

interface PreviewResponse {
  stats: BookStats;
  suggestedTitle: string;
  detectedLanguage: string;
}

interface CreateBookResponse {
  book: Book;
  jobs: Job[];
}

export const bookApi = {
  preview: (filePath: string, chunkingOptions?: ChunkingOptions): Promise<PreviewResponse> =>
    api.post<PreviewResponse>('/api/books/preview', { filePath, chunkingOptions }),

  create: (opts: {
    seriesId: string;
    filePath: string;
    title: string;
    author?: string;
    year?: number;
    genre?: string;
    language?: string;
    jobs: string[];
    chunkingOptions?: ChunkingOptions;
    excludedChunkIndices?: number[];
    chapterTitleOverrides?: Record<number, string>;
  }): Promise<CreateBookResponse> => api.post<CreateBookResponse>('/api/books', opts),

  list: (): Promise<Book[]> => api.get<Book[]>('/api/books'),

  getAbstracts: (id: string): Promise<Abstract[]> =>
    api.get<Abstract[]>(`/api/books/${id}/abstracts`),

  enqueueJob: (
    id: string,
    type: 'abstract_generation' | 'embedding_generation',
    opts?: { chainAbstractGeneration?: boolean; resume?: boolean },
  ): Promise<{ job: Job }> =>
    api.post<{ job: Job }>(`/api/books/${id}/jobs`, {
      type,
      ...(opts?.chainAbstractGeneration ? { chainAbstractGeneration: true } : {}),
      ...(opts?.resume ? { resume: true } : {}),
    }),

  searchEmbeddings: (
    id: string,
    query: string,
    n: number,
  ): Promise<{ results: EmbeddingSearchResult[] }> =>
    api.post<{ results: EmbeddingSearchResult[] }>(`/api/books/${id}/embeddings/search`, {
      query,
      n,
    }),

  update: (
    id: string,
    patch: {
      title?: string;
      author?: string | null;
      year?: number | null;
      genre?: string | null;
      language?: string | null;
    },
  ): Promise<Book> => api.patch<Book>(`/api/books/${id}`, patch),

  setEmbeddingOverride: (id: string, override: boolean): Promise<void> =>
    api.patch<void>(`/api/books/${id}/embedding-override`, { override }),

  remove: (id: string): Promise<void> => api.del(`/api/books/${id}`),

  exportBook: async (bookId: string, embeddings: boolean): Promise<void> => {
    const base = await resolveBaseUrl();
    const res = await fetch(
      `${base}/api/books/${encodeURIComponent(bookId)}/export?embeddings=${embeddings ? 1 : 0}`,
    );
    if (!res.ok) throw new ApiError(res.status, `Export failed: ${res.status}`);
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] ?? 'export.zip';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  exportSeries: async (seriesId: string, embeddings: boolean): Promise<void> => {
    const base = await resolveBaseUrl();
    const res = await fetch(
      `${base}/api/series/${encodeURIComponent(seriesId)}/export?embeddings=${embeddings ? 1 : 0}`,
    );
    if (!res.ok) throw new ApiError(res.status, `Export failed: ${res.status}`);
    const disposition = res.headers.get('content-disposition') ?? '';
    const match = disposition.match(/filename="?([^"]+)"?/);
    const filename = match?.[1] ?? 'export.zip';
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },

  peekZip: async (file: File): Promise<{ type: 'series' | 'book'; seriesTitle: string; bookCount: number }> => {
    const buffer = await file.arrayBuffer();
    return bookApi.peekZipBuffer(buffer);
  },

  peekZipBuffer: async (
    body: ArrayBuffer | Uint8Array,
  ): Promise<{ type: 'series' | 'book'; seriesTitle: string; bookCount: number }> => {
    const base = await resolveBaseUrl();
    const res = await fetch(`${base}/api/import/peek`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, `Peek failed: ${messageFromErrorResponseBody(text)}`, text);
    }
    return res.json() as Promise<{ type: 'series' | 'book'; seriesTitle: string; bookCount: number }>;
  },

  peekZipSource: async (
    src: ZipImportSource,
  ): Promise<{ type: 'series' | 'book'; seriesTitle: string; bookCount: number }> => {
    if (src.kind === 'file') return bookApi.peekZip(src.file);
    const bytes = await window.electronAPI.readFileBytes(src.path);
    return bookApi.peekZipBuffer(bytes);
  },

  importZip: async (file: File, seriesId?: string): Promise<ImportResult> => {
    const buffer = await file.arrayBuffer();
    return bookApi.importZipBuffer(buffer, seriesId);
  },

  importZipBuffer: async (body: ArrayBuffer | Uint8Array, seriesId?: string): Promise<ImportResult> => {
    const base = await resolveBaseUrl();
    const url = seriesId ? `${base}/api/import?seriesId=${encodeURIComponent(seriesId)}` : `${base}/api/import`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body,
    });
    if (!res.ok) {
      const text = await res.text();
      throw new ApiError(res.status, `Import failed: ${messageFromErrorResponseBody(text)}`, text);
    }
    return res.json() as Promise<ImportResult>;
  },

  importZipSource: async (src: ZipImportSource, seriesId?: string): Promise<ImportResult> => {
    if (src.kind === 'file') return bookApi.importZip(src.file, seriesId);
    const bytes = await window.electronAPI.readFileBytes(src.path);
    return bookApi.importZipBuffer(bytes, seriesId);
  },
};
