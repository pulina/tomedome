export function normalizeEmbeddingPrefix(s: string | null | undefined): string {
  return (s ?? '').trim();
}

/**
 * Normalize an embedding model name for comparison across providers.
 * Strips an optional `provider/` prefix (OpenRouter convention) and replaces
 * `:` with `-` (Ollama uses `name:tag` while other registries use `name-tag`).
 * Example equivalences: "openai/text-embedding-3-small" == "text-embedding-3-small",
 *   "qwen/qwen3-embedding-8b" == "qwen3-embedding:8b".
 */
export function normalizeEmbeddingModelName(model: string | null | undefined): string {
  let s = (model ?? '').trim();
  const slash = s.indexOf('/');
  if (slash !== -1) s = s.slice(slash + 1);
  return s.replace(/:/g, '-');
}

export function withEmbeddingQueryPrefix(text: string, prefix: string): string {
  return `${prefix}${text}`;
}

export function withEmbeddingPassagePrefix(text: string, prefix: string): string {
  return `${prefix}${text}`;
}

export interface EmbeddingProfileBookLike {
  chunkCount: number;
  embeddedAt?: string;
  embeddingModel?: string;
  embeddingModelOverride?: boolean;
  embeddingPassagePrefixSnapshot?: string;
  /** Settings snapshot when user allowed RAG despite mismatch (embedding model + passage prefix). */
  embeddingOverrideLockModel?: string;
  embeddingOverrideLockPassagePrefix?: string;
}

/** True when per-book RAG override is on and still matches current embedding model + passage prefix. */
export function embeddingOverrideActive(
  book: EmbeddingProfileBookLike,
  currentModel: string | null,
  currentPassagePrefix: string,
): boolean {
  if (!book.embeddingModelOverride) return false;
  const lockM = normalizeEmbeddingModelName(book.embeddingOverrideLockModel);
  if (!lockM) return false;
  const lockP = normalizeEmbeddingPrefix(book.embeddingOverrideLockPassagePrefix);
  const curM = normalizeEmbeddingModelName(currentModel);
  const curP = normalizeEmbeddingPrefix(currentPassagePrefix);
  return lockM === curM && lockP === curP;
}

/** True when stored vectors (model + passage instruct) differ from current settings. Query prefix is not part of stored vectors. */
export function bookStoredEmbeddingProfileDiffers(
  book: EmbeddingProfileBookLike,
  currentModel: string | null,
  currentPassagePrefix: string,
): boolean {
  if (book.chunkCount === 0 || !book.embeddedAt) return false;
  const cur = normalizeEmbeddingModelName(currentModel);
  if (!cur) return false;
  const storedModel = normalizeEmbeddingModelName(book.embeddingModel);
  if (!storedModel) return true;
  if (storedModel !== cur) return true;
  if (normalizeEmbeddingPrefix(book.embeddingPassagePrefixSnapshot) !== normalizeEmbeddingPrefix(currentPassagePrefix)) {
    return true;
  }
  return false;
}

/** True when RAG should be blocked: profile differs and per-book override is off. */
export function bookEmbeddingProfileMismatch(
  book: EmbeddingProfileBookLike,
  currentModel: string | null,
  currentPassagePrefix: string,
): boolean {
  if (embeddingOverrideActive(book, currentModel, currentPassagePrefix)) return false;
  return bookStoredEmbeddingProfileDiffers(book, currentModel, currentPassagePrefix);
}
