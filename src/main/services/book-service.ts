import { randomUUID } from 'crypto';
import { getDb } from './database';
import type { Abstract, Book } from '../../shared/types';
import type { RawChunk } from './ingest-service';
import { getEmbeddingModel, getEmbeddingPassagePrefix } from './config-service';

interface BookRow {
  id: string;
  series_id: string | null;
  series_title: string | null;
  title: string;
  author: string | null;
  year: number | null;
  genre: string | null;
  language: string | null;
  file_path: string;
  word_count: number;
  chunk_count: number;
  ingested_at: string | null;
  abstracted_at: string | null;
  embedded_at: string | null;
  embedding_model: string | null;
  embedding_model_override: number;
  embedding_override_lock_model: string | null;
  embedding_override_lock_passage_prefix: string | null;
  embedding_query_prefix_snapshot: string | null;
  embedding_passage_prefix_snapshot: string | null;
  series_order: number | null;
  created_at: string;
}

const BOOK_SELECT = `
  SELECT b.*, s.title as series_title
  FROM books b
  LEFT JOIN series s ON s.id = b.series_id
`;

function rowToBook(row: BookRow): Book {
  return {
    id: row.id,
    seriesId: row.series_id ?? '',
    seriesTitle: row.series_title ?? '',
    title: row.title,
    author: row.author ?? undefined,
    year: row.year ?? undefined,
    genre: row.genre ?? undefined,
    language: row.language ?? undefined,
    seriesOrder: row.series_order ?? undefined,
    filePath: row.file_path,
    wordCount: row.word_count,
    chunkCount: row.chunk_count,
    ingestedAt: row.ingested_at ?? undefined,
    abstractedAt: row.abstracted_at ?? undefined,
    embeddedAt: row.embedded_at ?? undefined,
    embeddingModel: row.embedding_model ?? undefined,
    embeddingModelOverride: row.embedding_model_override === 1,
    embeddingOverrideLockModel: row.embedding_override_lock_model ?? undefined,
    embeddingOverrideLockPassagePrefix: row.embedding_override_lock_passage_prefix ?? undefined,
    embeddingQueryPrefixSnapshot:
      row.embedding_query_prefix_snapshot != null ? row.embedding_query_prefix_snapshot : '',
    embeddingPassagePrefixSnapshot:
      row.embedding_passage_prefix_snapshot != null ? row.embedding_passage_prefix_snapshot : '',
    createdAt: row.created_at,
  };
}

export interface CreateBookInput {
  seriesId: string;
  title: string;
  author?: string;
  year?: number;
  genre?: string;
  language?: string;
  filePath: string;
  wordCount: number;
}

export function createBook(input: CreateBookInput): Book {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(
      `INSERT INTO books (id, series_id, title, author, year, genre, language, file_path, word_count, chunk_count, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
    )
    .run(
      id,
      input.seriesId,
      input.title,
      input.author ?? null,
      input.year ?? null,
      input.genre ?? null,
      input.language ?? null,
      input.filePath,
      input.wordCount,
      now,
    );
  const db = getDb();
  const maxRow = db
    .prepare(
      `SELECT MAX(series_order) AS max_order FROM books WHERE series_id = ? AND id != ?`,
    )
    .get(input.seriesId, id) as { max_order: number | null };
  const nextOrder = (maxRow.max_order ?? 0) + 1;
  db.prepare(`UPDATE books SET series_order = ? WHERE id = ?`).run(nextOrder, id);
  return rowToBook(db.prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(id) as BookRow);
}

export function saveChunks(bookId: string, chunks: RawChunk[]): void {
  const db = getDb();
  const insert = db.prepare(
    `INSERT INTO chunks (id, book_id, chapter_number, chapter_title, paragraph_index, raw_text, token_count)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  const insertMany = db.transaction((rows: RawChunk[]) => {
    for (const c of rows) {
      insert.run(
        randomUUID(),
        bookId,
        c.chapterNumber ?? null,
        c.chapterTitle ?? null,
        c.paragraphIndex,
        c.rawText,
        c.tokenCount,
      );
    }
  });
  insertMany(chunks);
  db.prepare(`UPDATE books SET chunk_count=?, ingested_at=? WHERE id=?`).run(
    chunks.length,
    new Date().toISOString(),
    bookId,
  );
}

export function listBooks(): Book[] {
  const db = getDb();
  const books = (
    db.prepare(`${BOOK_SELECT} ORDER BY b.created_at DESC`).all() as BookRow[]
  ).map(rowToBook);

  // Auto-heal: backfill embedding_model from actual chunk embeddings for books
  // that were embedded before model tracking was added to the schema.
  for (const book of books) {
    if (book.embeddedAt && !book.embeddingModel) {
      const row = db
        .prepare(
          `SELECT ce.model FROM chunk_embeddings ce
           JOIN chunks c ON c.id = ce.chunk_id
           WHERE c.book_id = ?
           ORDER BY c.paragraph_index ASC
           LIMIT 1`,
        )
        .get(book.id) as { model: string } | undefined;
      const absRow =
        row?.model == null
          ? (db
              .prepare(
                `SELECT ae.model FROM abstract_embeddings ae
                 JOIN abstracts a ON a.id = ae.abstract_id
                 WHERE a.book_id = ?
                 LIMIT 1`,
              )
              .get(book.id) as { model: string } | undefined)
          : undefined;
      const model = row?.model ?? absRow?.model;
      if (model) {
        db.prepare(`UPDATE books SET embedding_model = ? WHERE id = ?`).run(model, book.id);
        book.embeddingModel = model;
      }
    }
  }

  return books;
}

export function listBooksBySeries(seriesId: string): Book[] {
  return (
    getDb()
      .prepare(
        `${BOOK_SELECT} WHERE b.series_id = ? ORDER BY COALESCE(b.series_order, 999999) ASC, b.created_at ASC`,
      )
      .all(seriesId) as BookRow[]
  ).map(rowToBook);
}

export function getBook(id: string): Book | undefined {
  const row = getDb()
    .prepare(`${BOOK_SELECT} WHERE b.id = ?`)
    .get(id) as BookRow | undefined;
  return row ? rowToBook(row) : undefined;
}

export function deleteBook(id: string): void {
  getDb().prepare(`DELETE FROM books WHERE id = ?`).run(id);
}

export interface UpdateBookInput {
  title?: string;
  author?: string | null;
  year?: number | null;
  genre?: string | null;
  language?: string | null;
}

export function updateBook(id: string, input: UpdateBookInput): Book | undefined {
  const db = getDb();
  const fields: string[] = [];
  const values: unknown[] = [];
  if (input.title !== undefined) { fields.push('title = ?'); values.push(input.title); }
  if ('author' in input) { fields.push('author = ?'); values.push(input.author ?? null); }
  if ('year' in input) { fields.push('year = ?'); values.push(input.year ?? null); }
  if ('genre' in input) { fields.push('genre = ?'); values.push(input.genre ?? null); }
  if ('language' in input) { fields.push('language = ?'); values.push(input.language ?? null); }
  if (fields.length === 0) return getBook(id);
  values.push(id);
  db.prepare(`UPDATE books SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return getBook(id);
}

export function reorderBooksInSeries(seriesId: string, orderedBookIds: string[]): void {
  const db = getDb();
  const rows = db.prepare(`SELECT id FROM books WHERE series_id = ?`).all(seriesId) as { id: string }[];
  if (rows.length !== orderedBookIds.length) {
    throw new Error('bookIds must list every book in the series exactly once');
  }
  const expected = new Set(rows.map((r) => r.id));
  const seen = new Set<string>();
  for (const id of orderedBookIds) {
    if (!expected.has(id) || seen.has(id)) {
      throw new Error('invalid or duplicate book id in bookIds');
    }
    seen.add(id);
  }
  db.transaction(() => {
    for (let i = 0; i < orderedBookIds.length; i++) {
      db.prepare(`UPDATE books SET series_order = ? WHERE id = ? AND series_id = ?`).run(
        i + 1,
        orderedBookIds[i],
        seriesId,
      );
    }
  })();
}

export interface ChunkRow {
  id: string;
  book_id: string;
  chapter_number: number | null;
  chapter_title: string | null;
  paragraph_index: number;
  raw_text: string;
  token_count: number;
}

export function getChunks(bookId: string): ChunkRow[] {
  return getDb()
    .prepare(`SELECT * FROM chunks WHERE book_id = ? ORDER BY paragraph_index`)
    .all(bookId) as ChunkRow[];
}


export interface ChunkWindowResult {
  bookTitle: string;
  bookId: string;
  chunks: ChunkRow[];
  anchorIndex: number;
}

export function getChunkWindow(chunkId: string, before: number, after: number): ChunkWindowResult | null {
  const db = getDb();

  const anchor = db
    .prepare(
      `SELECT c.*, b.title AS book_title FROM chunks c JOIN books b ON b.id = c.book_id WHERE c.id = ?`,
    )
    .get(chunkId) as (ChunkRow & { book_title: string }) | undefined;

  if (!anchor) return null;

  const chunks = db
    .prepare(
      `SELECT * FROM chunks
       WHERE book_id = ?
         AND paragraph_index BETWEEN ? AND ?
       ORDER BY paragraph_index`,
    )
    .all(anchor.book_id, anchor.paragraph_index - before, anchor.paragraph_index + after) as ChunkRow[];

  return {
    bookTitle: anchor.book_title,
    bookId: anchor.book_id,
    chunks,
    anchorIndex: anchor.paragraph_index,
  };
}

export interface ChapterEntry {
  chapterNumber: number;
  chapterTitle: string | null;
}

export function listChapters(bookId: string): ChapterEntry[] {
  const db = getDb();

  // Re-abstracted books can have multiple rows per chapter_number; pick the title
  // from the most recent row (MAX(rowid)). SQLite guarantees bare columns in an
  // aggregate query come from the row that satisfies the aggregate, so chapter_title
  // here is always from the latest abstract row for that chapter.
  let rows = db
    .prepare(
      `SELECT chapter_number, chapter_title
       FROM (
         SELECT chapter_number, chapter_title, MAX(rowid)
         FROM abstracts
         WHERE book_id = ? AND chapter_number IS NOT NULL
         GROUP BY chapter_number
       )
       ORDER BY chapter_number ASC`,
    )
    .all(bookId) as Array<{ chapter_number: number; chapter_title: string | null }>;

  // Fallback: no abstracts yet — derive chapter list from raw chunk metadata.
  if (rows.length === 0) {
    rows = db
      .prepare(
        `SELECT chapter_number, chapter_title
         FROM (
           SELECT chapter_number, chapter_title, MAX(rowid)
           FROM chunks
           WHERE book_id = ? AND chapter_number IS NOT NULL
           GROUP BY chapter_number
         )
         ORDER BY chapter_number ASC`,
      )
      .all(bookId) as Array<{ chapter_number: number; chapter_title: string | null }>;
  }

  return rows.map((r) => ({ chapterNumber: r.chapter_number, chapterTitle: r.chapter_title }));
}

export interface AnnotatedChapterEntry extends ChapterEntry {
  /** "(part N of M)" when consecutive chapters share the same title; null otherwise. */
  partLabel: string | null;
}

/**
 * Detect consecutive chapters that share the same title (split chapters) and
 * annotate each with "(part N of M)". Input must be sorted by chapterNumber ASC.
 */
export function annotateChapterSplits(chapters: ChapterEntry[]): AnnotatedChapterEntry[] {
  const partLabels = new Map<number, string>();
  let i = 0;
  while (i < chapters.length) {
    const title = chapters[i]!.chapterTitle;
    let j = i + 1;
    // Advance j while the title is the same AND chapter numbers are consecutive.
    while (
      j < chapters.length &&
      title !== null &&
      chapters[j]!.chapterTitle === title &&
      chapters[j]!.chapterNumber === chapters[j - 1]!.chapterNumber + 1
    ) {
      j++;
    }
    const count = j - i;
    if (count > 1) {
      for (let k = 0; k < count; k++) {
        partLabels.set(chapters[i + k]!.chapterNumber, `(part ${k + 1} of ${count})`);
      }
    }
    i = j;
  }
  return chapters.map((c) => ({ ...c, partLabel: partLabels.get(c.chapterNumber) ?? null }));
}

export function saveAbstract(
  bookId: string,
  chapterNumber: number | null,
  chapterTitle: string | null,
  level: 'chapter_detailed' | 'chapter_short' | 'book',
  content: string,
): void {
  getDb()
    .prepare(
      `INSERT INTO abstracts (id, book_id, chapter_number, chapter_title, level, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(randomUUID(), bookId, chapterNumber ?? null, chapterTitle ?? null, level, content, new Date().toISOString());
}

export function markBookAbstracted(bookId: string): void {
  getDb()
    .prepare(`UPDATE books SET abstracted_at = ? WHERE id = ?`)
    .run(new Date().toISOString(), bookId);
}

export function setBookEmbeddingOverride(bookId: string, override: boolean): void {
  const db = getDb();
  if (override) {
    const lockModel = getEmbeddingModel().trim();
    const lockPassage = getEmbeddingPassagePrefix();
    db.prepare(
      `UPDATE books SET embedding_model_override = 1,
         embedding_override_lock_model = ?,
         embedding_override_lock_passage_prefix = ?
       WHERE id = ?`,
    ).run(lockModel, lockPassage, bookId);
  } else {
    db.prepare(
      `UPDATE books SET embedding_model_override = 0,
         embedding_override_lock_model = NULL,
         embedding_override_lock_passage_prefix = NULL
       WHERE id = ?`,
    ).run(bookId);
  }
}

export function markBookEmbedded(
  bookId: string,
  model: string,
  passagePrefixSnapshot: string,
  queryPrefixSnapshot: string,
): void {
  getDb()
    .prepare(
      `UPDATE books SET embedded_at = ?, embedding_model = ?, embedding_passage_prefix_snapshot = ?, embedding_query_prefix_snapshot = ?,
         embedding_model_override = 0, embedding_override_lock_model = NULL, embedding_override_lock_passage_prefix = NULL
       WHERE id = ?`,
    )
    .run(new Date().toISOString(), model, passagePrefixSnapshot, queryPrefixSnapshot, bookId);
}

export function bookHasChunkEmbeddings(bookId: string): boolean {
  const row = getDb()
    .prepare(
      `SELECT 1 AS ok FROM chunk_embeddings ce
       INNER JOIN chunks c ON c.id = ce.chunk_id
       WHERE c.book_id = ?
       LIMIT 1`,
    )
    .get(bookId) as { ok: number } | undefined;
  return !!row;
}

/**
 * Abstract RAG filters use `books.embedding_*_prefix_snapshot`. Chunk embed sets those via
 * `markBookEmbedded`. If the book has no chunk vectors yet, abstract-only embed must still
 * refresh snapshots or semantic abstract search excludes the book. When chunk vectors exist,
 * snapshots stay owned by the chunk job — changing passage prefix then re-embedding only abstracts
 * still requires a chunk re-embed to stay consistent.
 */
export function syncBookEmbeddingSnapshotAfterAbstractJob(
  bookId: string,
  model: string,
  passagePrefixSnapshot: string,
  queryPrefixSnapshot: string,
): void {
  if (bookHasChunkEmbeddings(bookId)) return;
  getDb()
    .prepare(
      `UPDATE books SET embedding_model = ?,
         embedding_passage_prefix_snapshot = ?,
         embedding_query_prefix_snapshot = ?
       WHERE id = ?`,
    )
    .run(model, passagePrefixSnapshot, queryPrefixSnapshot, bookId);
}

export function clearAbstracts(bookId: string): void {
  getDb().prepare(`DELETE FROM abstracts WHERE book_id = ?`).run(bookId);
  getDb().prepare(`UPDATE books SET abstracted_at = NULL WHERE id = ?`).run(bookId);
}

export interface ChapterShortAbstract {
  bookId: string;
  bookTitle: string;
  chapterNumber: number;
  chapterTitle: string | null;
  content: string;
}

/**
 * Bulk-fetch chapter_short abstracts for a list of (bookId, chapterNumber) pairs.
 * Returns only pairs that have an abstract — missing ones are silently omitted.
 */
export function getChapterShortAbstracts(
  pairs: Array<{ bookId: string; chapterNumber: number }>,
): ChapterShortAbstract[] {
  if (pairs.length === 0) return [];

  const db = getDb();
  const placeholders = pairs.map(() => '(?, ?)').join(', ');
  const params: (string | number)[] = pairs.flatMap((p) => [p.bookId, p.chapterNumber]);

  const rows = db
    .prepare(
      `SELECT a.book_id, b.title AS book_title, a.chapter_number, a.chapter_title, a.content
       FROM abstracts a
       JOIN books b ON b.id = a.book_id
       WHERE a.level = 'chapter_short'
         AND (a.book_id, a.chapter_number) IN (${placeholders})`,
    )
    .all(...params) as Array<{
    book_id: string;
    book_title: string;
    chapter_number: number;
    chapter_title: string | null;
    content: string;
  }>;

  return rows.map((r) => ({
    bookId: r.book_id,
    bookTitle: r.book_title,
    chapterNumber: r.chapter_number,
    chapterTitle: r.chapter_title,
    content: r.content,
  }));
}

export function getAbstracts(bookId: string): Abstract[] {
  const rows = getDb()
    .prepare(
      `SELECT * FROM abstracts WHERE book_id = ?
       ORDER BY CASE level WHEN 'book' THEN 0 WHEN 'chapter_short' THEN 1 ELSE 2 END,
                chapter_number ASC`,
    )
    .all(bookId) as {
    id: string;
    book_id: string;
    chapter_number: number | null;
    chapter_title: string | null;
    level: string;
    content: string;
    created_at: string;
  }[];
  return rows.map((r) => ({
    id: r.id,
    bookId: r.book_id,
    chapterNumber: r.chapter_number,
    chapterTitle: r.chapter_title ?? null,
    level: r.level as Abstract['level'],
    content: r.content,
    createdAt: r.created_at,
  }));
}
