import { getDb } from './database';

interface EmbeddingInput {
  chunkId: string;
  vector: number[];
  model: string;
}

export function saveEmbeddings(embeddings: EmbeddingInput[]): void {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, vector, model, dim, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertAll = db.transaction((rows: EmbeddingInput[]) => {
    for (const e of rows) {
      upsert.run(e.chunkId, JSON.stringify(e.vector), e.model, e.vector.length, now);
    }
  });
  insertAll(embeddings);
}

export function getBookEmbeddings(bookId: string): Array<{ chunkId: string; vector: number[] }> {
  const rows = getDb()
    .prepare(
      `SELECT ce.chunk_id, ce.vector
       FROM chunk_embeddings ce
       JOIN chunks c ON c.id = ce.chunk_id
       WHERE c.book_id = ?`,
    )
    .all(bookId) as Array<{ chunk_id: string; vector: string }>;
  return rows.map((r) => ({ chunkId: r.chunk_id, vector: JSON.parse(r.vector) as number[] }));
}

export function deleteBookEmbeddings(bookId: string): void {
  getDb()
    .prepare(
      `DELETE FROM chunk_embeddings WHERE chunk_id IN (SELECT id FROM chunks WHERE book_id = ?)`,
    )
    .run(bookId);
}

export interface SearchResult {
  chunkId: string;
  score: number;
  text: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
}

export interface RagResult {
  chunkId: string;
  bookId: string;
  chapterNumber: number | null;
  score: number;
  text: string;
  chapterTitle: string | null;
  bookTitle: string;
}

/** Single-book semantic search over abstract embeddings — used by the Embeddings Inspector. */
export function searchBookAbstractEmbeddings(
  bookId: string,
  queryVector: number[],
  topN: number,
): Array<SearchResult & { level: string }> {
  const rows = getDb()
    .prepare(
      `SELECT ae.abstract_id, ae.vector, a.content, a.chapter_number, a.chapter_title, a.level
       FROM abstract_embeddings ae
       JOIN abstracts a ON a.id = ae.abstract_id
       WHERE a.book_id = ?`,
    )
    .all(bookId) as Array<{
    abstract_id: string;
    vector: string;
    content: string;
    chapter_number: number | null;
    chapter_title: string | null;
    level: string;
  }>;

  const scored = rows.map((r) => ({
    chunkId: r.abstract_id,
    score: cosineSimilarity(queryVector, JSON.parse(r.vector) as number[]),
    text: r.content,
    chapterNumber: r.chapter_number,
    chapterTitle: r.chapter_title,
    level: r.level,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/** Cross-book semantic search — used for RAG context injection in chat. */
export function searchAllForRag(queryVector: number[], topN: number, model?: string, seriesId?: string | null): RagResult[] {
  const seriesClause = seriesId ? ' AND b.series_id = ?' : '';
  const sql = model
    ? `SELECT ce.chunk_id, ce.vector, c.book_id, c.chapter_number, c.chapter_title, c.raw_text, b.title AS book_title
       FROM chunk_embeddings ce
       JOIN chunks c ON c.id = ce.chunk_id
       JOIN books b ON b.id = c.book_id
       WHERE (ce.model = ? OR b.embedding_model_override = 1)${seriesClause}`
    : `SELECT ce.chunk_id, ce.vector, c.book_id, c.chapter_number, c.chapter_title, c.raw_text, b.title AS book_title
       FROM chunk_embeddings ce
       JOIN chunks c ON c.id = ce.chunk_id
       JOIN books b ON b.id = c.book_id${seriesId ? ' WHERE b.series_id = ?' : ''}`;
  const params: unknown[] = [];
  if (model) params.push(model);
  if (seriesId) params.push(seriesId);
  const rows = getDb().prepare(sql).all(...params) as Array<{
    chunk_id: string;
    vector: string;
    book_id: string;
    chapter_number: number | null;
    chapter_title: string | null;
    raw_text: string;
    book_title: string;
  }>;

  const scored = rows.map((r) => ({
    chunkId: r.chunk_id,
    bookId: r.book_id,
    chapterNumber: r.chapter_number,
    score: cosineSimilarity(queryVector, JSON.parse(r.vector) as number[]),
    text: r.raw_text,
    chapterTitle: r.chapter_title,
    bookTitle: r.book_title,
  }));
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

export function searchBookEmbeddings(
  bookId: string,
  queryVector: number[],
  topN: number,
): SearchResult[] {
  const rows = getDb()
    .prepare(
      `SELECT ce.chunk_id, ce.vector, c.raw_text, c.chapter_number, c.chapter_title
       FROM chunk_embeddings ce
       JOIN chunks c ON c.id = ce.chunk_id
       WHERE c.book_id = ?`,
    )
    .all(bookId) as Array<{
    chunk_id: string;
    vector: string;
    raw_text: string;
    chapter_number: number | null;
    chapter_title: string | null;
  }>;

  const scored = rows.map((r) => ({
    chunkId: r.chunk_id,
    score: cosineSimilarity(queryVector, JSON.parse(r.vector) as number[]),
    text: r.raw_text,
    chapterNumber: r.chapter_number,
    chapterTitle: r.chapter_title,
  }));

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topN);
}

/**
 * Full-text keyword search over chunks using SQLite FTS5.
 * Returns results in the same RagResult shape so they can be merged with
 * semantic hits. FTS5 bm25() ranks are ≤ 0 (lower = better). We map them to
 * (0, 1] via 1/(1−rank) so keyword scores sit on a similar scale to cosine
 * similarity and can be unioned/reranked with dense retrieval.
 * Returns [] on FTS query parse errors (e.g. special characters in query).
 */
export function searchChunksFts(query: string, topN: number, seriesId?: string | null): RagResult[] {
  try {
    const seriesClause = seriesId ? ' AND b.series_id = ?' : '';
    const rows = getDb()
      .prepare(
        `SELECT c.id AS chunk_id, c.book_id, c.chapter_number, c.chapter_title, c.raw_text,
                b.title AS book_title, bm25(chunks_fts) AS rank
         FROM chunks_fts
         JOIN chunks c ON c.rowid = chunks_fts.rowid
         JOIN books b ON b.id = c.book_id
         WHERE chunks_fts MATCH ?${seriesClause}
         ORDER BY rank
         LIMIT ?`,
      )
      .all(...(seriesId ? [query, seriesId, topN] : [query, topN])) as Array<{
      chunk_id: string;
      book_id: string;
      chapter_number: number | null;
      chapter_title: string | null;
      raw_text: string;
      book_title: string;
      rank: number;
    }>;

    return rows.map((r) => ({
      chunkId: r.chunk_id,
      bookId: r.book_id,
      chapterNumber: r.chapter_number,
      score: 1 / (1 - r.rank),
      text: r.raw_text,
      chapterTitle: r.chapter_title,
      bookTitle: r.book_title,
    }));
  } catch {
    // FTS query parse errors (special chars, empty string, etc.) — silently skip
    return [];
  }
}

export interface AbstractRagResult {
  abstractId: string;
  bookId: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
  level: string;
  score: number;
  text: string;
  bookTitle: string;
}

export function saveAbstractEmbeddings(
  embeddings: Array<{ abstractId: string; vector: number[]; model: string }>,
): void {
  const db = getDb();
  const now = new Date().toISOString();
  const upsert = db.prepare(
    `INSERT OR REPLACE INTO abstract_embeddings (abstract_id, vector, model, dim, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  );
  const insertAll = db.transaction(
    (rows: Array<{ abstractId: string; vector: number[]; model: string }>) => {
      for (const e of rows) {
        upsert.run(e.abstractId, JSON.stringify(e.vector), e.model, e.vector.length, now);
      }
    },
  );
  insertAll(embeddings);
}

export function deleteBookAbstractEmbeddings(bookId: string): void {
  getDb()
    .prepare(
      `DELETE FROM abstract_embeddings WHERE abstract_id IN (
         SELECT id FROM abstracts WHERE book_id = ?
       )`,
    )
    .run(bookId);
}

/** Cross-book semantic search over abstract embeddings — used to surface chapter
 *  summaries not covered by chunk retrieval (RAPTOR-inspired multi-level retrieval). */
export function searchAbstractsForRag(
  queryVector: number[],
  topN: number,
  levels: string[],
  model?: string,
  seriesId?: string | null,
): AbstractRagResult[] {
  if (levels.length === 0) return [];

  const placeholders = levels.map(() => '?').join(', ');
  const modelClause = model ? ' AND (ae.model = ? OR b.embedding_model_override = 1)' : '';
  const seriesClause = seriesId ? ' AND b.series_id = ?' : '';
  const params: unknown[] = model ? [...levels, model] : [...levels];
  if (seriesId) params.push(seriesId);
  const rows = getDb()
    .prepare(
      `SELECT ae.abstract_id, ae.vector, a.book_id, a.chapter_number, a.chapter_title,
              a.level, a.content, b.title AS book_title
       FROM abstract_embeddings ae
       JOIN abstracts a ON a.id = ae.abstract_id
       JOIN books b ON b.id = a.book_id
       WHERE a.level IN (${placeholders})${modelClause}${seriesClause}`,
    )
    .all(...params) as Array<{
    abstract_id: string;
    vector: string;
    book_id: string;
    chapter_number: number | null;
    chapter_title: string | null;
    level: string;
    content: string;
    book_title: string;
  }>;

  const scored = rows.map((r) => ({
    abstractId: r.abstract_id,
    bookId: r.book_id,
    chapterNumber: r.chapter_number,
    chapterTitle: r.chapter_title,
    level: r.level,
    score: cosineSimilarity(queryVector, JSON.parse(r.vector) as number[]),
    text: r.content,
    bookTitle: r.book_title,
  }));

  // One abstract per chapter (book-level uses chapterNumber null → key …:book)
  const byChapter = new Map<string, AbstractRagResult>();
  for (const hit of scored) {
    const key = `${hit.bookId}:${hit.chapterNumber ?? 'book'}`;
    const existing = byChapter.get(key);
    if (!existing || hit.score > existing.score) {
      byChapter.set(key, hit);
    }
  }

  const deduped = [...byChapter.values()].sort((a, b) => b.score - a.score);
  return deduped.slice(0, topN);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < a.length; i++) {
    const ai = a[i] ?? 0;
    const bi = b[i] ?? 0;
    dot += ai * bi;
    magA += ai * ai;
    magB += bi * bi;
  }
  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}
