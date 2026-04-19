import { randomUUID } from 'crypto';
import JSZip from 'jszip';
import { getDb } from './database';
import { listBooksBySeries, getChunks, getAbstracts } from './book-service';
import { getEmbeddingModel } from './config-service';
import type { ImportResult } from '@shared/types';

const CURRENT_SCHEMA_VERSION = 2;
const APP_VERSION = '0.1.0';

// ── Export ────────────────────────────────────────────────────────────────────

interface ExportChunk {
  paragraphIndex: number;
  chapterNumber: number | null;
  chapterTitle: string | null;
  tokenCount: number;
  text: string;
}

interface ExportAbstract {
  level: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
  content: string;
}

interface ExportEmbedding {
  source: 'chunk' | 'abstract';
  refIndex: number;
  model: string;
  dim: number;
  vector: number[];
}

interface ExportBook {
  title: string;
  author?: string;
  year?: number;
  genre?: string;
  language?: string;
  wordCount: number;
  chunkCount: number;
  embeddingModel?: string;
}

interface Manifest {
  schemaVersion: number;
  appVersion: string;
  exportedAt: string;
  type: 'series' | 'book';
  seriesTitle: string;
  seriesAbstract?: string;
  bookCount: number;
}

function packBook(zip: JSZip, book: ReturnType<typeof listBooksBySeries>[number], includeEmbeddings: boolean): void {
  const db = getDb();
  const dir = `books/${book.id}/`;

  zip.file(`${dir}book.json`, JSON.stringify({
    title: book.title,
    author: book.author,
    year: book.year,
    genre: book.genre,
    language: book.language,
    wordCount: book.wordCount,
    chunkCount: book.chunkCount,
    embeddingModel: book.embeddingModel,
  } satisfies ExportBook, null, 2));

  const chunks = getChunks(book.id);
  const exportChunks: ExportChunk[] = chunks.map((c) => ({
    paragraphIndex: c.paragraph_index,
    chapterNumber: c.chapter_number,
    chapterTitle: c.chapter_title,
    tokenCount: c.token_count,
    text: c.raw_text,
  }));
  zip.file(`${dir}chunks.json`, JSON.stringify(exportChunks));

  const abstracts = getAbstracts(book.id);
  const exportAbstracts: ExportAbstract[] = abstracts.map((a) => ({
    level: a.level,
    chapterNumber: a.chapterNumber,
    chapterTitle: a.chapterTitle,
    content: a.content,
  }));
  if (exportAbstracts.length > 0) {
    zip.file(`${dir}abstracts.json`, JSON.stringify(exportAbstracts));
  }

  if (includeEmbeddings) {
    const embeddings: ExportEmbedding[] = [];

    const chunkEmbRows = db
      .prepare(
        `SELECT ce.vector, ce.model, ce.dim, c.paragraph_index
         FROM chunk_embeddings ce
         JOIN chunks c ON c.id = ce.chunk_id
         WHERE c.book_id = ?
         ORDER BY c.paragraph_index`,
      )
      .all(book.id) as Array<{ vector: string; model: string; dim: number; paragraph_index: number }>;

    for (const row of chunkEmbRows) {
      const refIndex = exportChunks.findIndex((c) => c.paragraphIndex === row.paragraph_index);
      if (refIndex === -1) continue;
      embeddings.push({ source: 'chunk', refIndex, model: row.model, dim: row.dim, vector: JSON.parse(row.vector) as number[] });
    }

    if (abstracts.length > 0) {
      const abstractEmbRows = db
        .prepare(
          `SELECT ae.vector, ae.model, ae.dim, a.level, a.chapter_number
           FROM abstract_embeddings ae
           JOIN abstracts a ON a.id = ae.abstract_id
           WHERE a.book_id = ?`,
        )
        .all(book.id) as Array<{ vector: string; model: string; dim: number; level: string; chapter_number: number | null }>;

      for (const row of abstractEmbRows) {
        const refIndex = exportAbstracts.findIndex(
          (a) => a.level === row.level && a.chapterNumber === row.chapter_number,
        );
        if (refIndex === -1) continue;
        embeddings.push({ source: 'abstract', refIndex, model: row.model, dim: row.dim, vector: JSON.parse(row.vector) as number[] });
      }
    }

    if (embeddings.length > 0) {
      zip.file(`${dir}embeddings.json`, JSON.stringify(embeddings));
    }
  }
}

export async function exportSeries(seriesId: string, includeEmbeddings: boolean): Promise<Buffer> {
  const db = getDb();
  const seriesRow = db.prepare('SELECT title, abstract FROM series WHERE id = ?').get(seriesId) as { title: string; abstract: string | null } | undefined;
  if (!seriesRow) throw new Error('Series not found');

  const books = listBooksBySeries(seriesId);
  const zip = new JSZip();

  zip.file('manifest.json', JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    type: 'series',
    seriesTitle: seriesRow.title,
    ...(seriesRow.abstract ? { seriesAbstract: seriesRow.abstract } : {}),
    bookCount: books.length,
  } satisfies Manifest, null, 2));

  for (const book of books) packBook(zip, book, includeEmbeddings);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

export async function exportBook(bookId: string, includeEmbeddings: boolean): Promise<Buffer> {
  const db = getDb();
  const row = db
    .prepare('SELECT b.*, s.title AS series_title FROM books b JOIN series s ON s.id = b.series_id WHERE b.id = ?')
    .get(bookId) as ({ series_title: string } & Record<string, unknown>) | undefined;
  if (!row) throw new Error('Book not found');

  const books = listBooksBySeries(row.series_id as string);
  const book = books.find((b) => b.id === bookId);
  if (!book) throw new Error('Book not found');

  const zip = new JSZip();

  zip.file('manifest.json', JSON.stringify({
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: APP_VERSION,
    exportedAt: new Date().toISOString(),
    type: 'book',
    seriesTitle: row.series_title,
    bookCount: 1,
  } satisfies Manifest, null, 2));

  packBook(zip, book, includeEmbeddings);

  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

// ── Import ────────────────────────────────────────────────────────────────────

export async function peekZip(buffer: Buffer): Promise<{ type: 'series' | 'book'; seriesTitle: string; bookCount: number }> {
  const zip = await JSZip.loadAsync(buffer);
  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Invalid archive: missing manifest.json');
  const manifest = JSON.parse(await manifestFile.async('string')) as Manifest;
  return { type: manifest.type ?? 'series', seriesTitle: manifest.seriesTitle, bookCount: manifest.bookCount };
}

function uniqueSeriesTitle(baseTitle: string): string {
  const db = getDb();
  let title = baseTitle;
  let n = 1;
  while (db.prepare('SELECT id FROM series WHERE title = ?').get(title)) {
    title = n === 1 ? `${baseTitle} (copy)` : `${baseTitle} (copy ${n})`;
    n++;
  }
  return title;
}

export async function importZip(buffer: Buffer, targetSeriesId?: string): Promise<ImportResult> {
  const zip = await JSZip.loadAsync(buffer);

  const manifestFile = zip.file('manifest.json');
  if (!manifestFile) throw new Error('Invalid archive: missing manifest.json');
  const manifest = JSON.parse(await manifestFile.async('string')) as Manifest;

  let schemaWarning: string | undefined;
  if (manifest.schemaVersion > CURRENT_SCHEMA_VERSION) {
    schemaWarning = `Archive schema v${manifest.schemaVersion} is newer than app schema v${CURRENT_SCHEMA_VERSION}. Some data may not import correctly.`;
  }

  const db = getDb();

  let seriesId: string;

  let actualSeriesTitle: string;

  if (targetSeriesId) {
    // Book import: caller provides the series to import into
    const row = db.prepare('SELECT id, title FROM series WHERE id = ?').get(targetSeriesId) as { id: string; title: string } | undefined;
    if (!row) throw new Error('Target series not found');
    seriesId = targetSeriesId;
    actualSeriesTitle = row.title;
  } else {
    // Series import: always create a new series (unique title)
    actualSeriesTitle = uniqueSeriesTitle(manifest.seriesTitle);
    seriesId = randomUUID();
    const now = new Date().toISOString();
    db.prepare('INSERT INTO series (id, title, abstract, abstracted_at, created_at) VALUES (?, ?, ?, ?, ?)').run(
      seriesId,
      actualSeriesTitle,
      manifest.seriesAbstract ?? null,
      manifest.seriesAbstract ? now : null,
      now,
    );
  }

  const importedBooks: ImportResult['books'] = [];

  // Collect book dirs
  const bookDirs = new Set<string>();
  zip.forEach((path) => {
    const match = path.match(/^books\/([^/]+)\//);
    if (match?.[1]) bookDirs.add(match[1]);
  });

  for (const bookDir of bookDirs) {
    const prefix = `books/${bookDir}/`;

    const bookFile = zip.file(`${prefix}book.json`);
    if (!bookFile) continue;
    const bookMeta = JSON.parse(await bookFile.async('string')) as ExportBook;

    // Collision: append (copy) if title exists in this series
    let title = bookMeta.title;
    const existing = db
      .prepare('SELECT id FROM books WHERE series_id = ? AND title = ?')
      .get(seriesId, title) as { id: string } | undefined;
    let warning: string | undefined;
    if (existing) {
      title = `${title} (copy)`;
      warning = `Renamed to "${title}" — a book with that title already exists in this series.`;
    }

    const bookId = randomUUID();
    const now = new Date().toISOString();

    db.prepare(
      `INSERT INTO books
         (id, series_id, title, author, year, genre, language, file_path,
          word_count, chunk_count, embedding_model, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      bookId,
      seriesId,
      title,
      bookMeta.author ?? null,
      bookMeta.year ?? null,
      bookMeta.genre ?? null,
      bookMeta.language ?? null,
      '',  // no original file path
      bookMeta.wordCount,
      bookMeta.chunkCount,
      bookMeta.embeddingModel ?? null,
      now,
    );

    // Chunks
    const chunksFile = zip.file(`${prefix}chunks.json`);
    const chunks: ExportChunk[] = chunksFile
      ? (JSON.parse(await chunksFile.async('string')) as ExportChunk[])
      : [];

    const insertChunk = db.prepare(
      `INSERT INTO chunks (id, book_id, chapter_number, chapter_title, paragraph_index, raw_text, token_count)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const chunkIds: string[] = [];
    db.transaction(() => {
      for (const c of chunks) {
        const id = randomUUID();
        chunkIds.push(id);
        insertChunk.run(
          id, bookId,
          c.chapterNumber ?? null,
          c.chapterTitle ?? null,
          c.paragraphIndex,
          c.text,
          c.tokenCount,
        );
      }
    })();

    // Update chunk_count with actual imported count
    db.prepare('UPDATE books SET chunk_count = ?, ingested_at = ? WHERE id = ?').run(
      chunks.length, now, bookId,
    );

    // Abstracts
    const abstractsFile = zip.file(`${prefix}abstracts.json`);
    const abstracts: ExportAbstract[] = abstractsFile
      ? (JSON.parse(await abstractsFile.async('string')) as ExportAbstract[])
      : [];

    const insertAbstract = db.prepare(
      `INSERT INTO abstracts (id, book_id, chapter_number, chapter_title, level, content, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    );
    const abstractIds: string[] = [];
    if (abstracts.length > 0) {
      db.transaction(() => {
        for (const a of abstracts) {
          const id = randomUUID();
          abstractIds.push(id);
          insertAbstract.run(
            id, bookId,
            a.chapterNumber ?? null,
            a.chapterTitle ?? null,
            a.level,
            a.content,
            now,
          );
        }
      })();
      db.prepare('UPDATE books SET abstracted_at = ? WHERE id = ?').run(now, bookId);
    }

    // Embeddings (optional)
    const embeddingsFile = zip.file(`${prefix}embeddings.json`);
    if (embeddingsFile) {
      const embeddings = JSON.parse(await embeddingsFile.async('string')) as ExportEmbedding[];

      const insertChunkEmb = db.prepare(
        `INSERT OR REPLACE INTO chunk_embeddings (chunk_id, vector, model, dim, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );
      const insertAbstractEmb = db.prepare(
        `INSERT OR REPLACE INTO abstract_embeddings (abstract_id, vector, model, dim, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      );

      db.transaction(() => {
        for (const e of embeddings) {
          if (e.source === 'chunk') {
            const chunkId = chunkIds[e.refIndex];
            if (!chunkId) continue;
            insertChunkEmb.run(chunkId, JSON.stringify(e.vector), e.model, e.dim, now);
          } else {
            const abstractId = abstractIds[e.refIndex];
            if (!abstractId) continue;
            insertAbstractEmb.run(abstractId, JSON.stringify(e.vector), e.model, e.dim, now);
          }
        }
      })();

      // Derive embedding model from the first chunk embedding if not present in book.json
      const embeddingModelFromVectors =
        embeddings.find((e) => e.source === 'chunk')?.model ?? null;
      const resolvedEmbeddingModel = bookMeta.embeddingModel ?? embeddingModelFromVectors;

      if (resolvedEmbeddingModel) {
        db.prepare('UPDATE books SET embedded_at = ?, embedding_model = ? WHERE id = ?').run(
          now, resolvedEmbeddingModel, bookId,
        );
      } else {
        db.prepare('UPDATE books SET embedded_at = ? WHERE id = ?').run(now, bookId);
      }

      // Warn if the imported embeddings were built with a different model than currently configured.
      const currentModel = getEmbeddingModel();
      if (resolvedEmbeddingModel && currentModel && resolvedEmbeddingModel !== currentModel) {
        const mismatchNote = `Embeddings use model "${resolvedEmbeddingModel}" but current model is "${currentModel}" — re-run embedding generation.`;
        warning = warning ? `${warning} ${mismatchNote}` : mismatchNote;
      }
    }

    importedBooks.push({ id: bookId, title, warning });
  }

  return { seriesId, seriesTitle: actualSeriesTitle, books: importedBooks, schemaWarning };
}
