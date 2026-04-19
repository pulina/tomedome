import { randomUUID } from 'crypto';
import { getDb } from './database';
import type { Abstract, Book } from '../../shared/types';
import type { RawChunk } from './ingest-service';

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
    filePath: row.file_path,
    wordCount: row.word_count,
    chunkCount: row.chunk_count,
    ingestedAt: row.ingested_at ?? undefined,
    abstractedAt: row.abstracted_at ?? undefined,
    embeddedAt: row.embedded_at ?? undefined,
    embeddingModel: row.embedding_model ?? undefined,
    embeddingModelOverride: row.embedding_model_override === 1,
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
  return rowToBook(
    getDb().prepare(`${BOOK_SELECT} WHERE b.id = ?`).get(id) as BookRow,
  );
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
      if (row?.model) {
        db.prepare(`UPDATE books SET embedding_model = ? WHERE id = ?`).run(row.model, book.id);
        book.embeddingModel = row.model;
      }
    }
  }

  return books;
}

export function listBooksBySeries(seriesId: string): Book[] {
  return (
    getDb()
      .prepare(`${BOOK_SELECT} WHERE b.series_id = ? ORDER BY b.created_at ASC`)
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
  getDb()
    .prepare(`UPDATE books SET embedding_model_override = ? WHERE id = ?`)
    .run(override ? 1 : 0, bookId);
}

export function markBookEmbedded(bookId: string, model: string): void {
  getDb()
    .prepare(`UPDATE books SET embedded_at = ?, embedding_model = ? WHERE id = ?`)
    .run(new Date().toISOString(), model, bookId);
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
