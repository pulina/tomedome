import { randomUUID } from 'crypto';
import { getDb } from './database';
import type { Series } from '../../shared/types';

interface SeriesRow {
  id: string;
  title: string;
  description: string | null;
  abstract: string | null;
  abstracted_at: string | null;
  created_at: string;
  book_count: number;
}

function rowToSeries(row: SeriesRow): Series {
  return {
    id: row.id,
    title: row.title,
    description: row.description ?? undefined,
    abstract: row.abstract ?? undefined,
    abstractedAt: row.abstracted_at ?? undefined,
    bookCount: row.book_count,
    createdAt: row.created_at,
  };
}

const SERIES_SELECT = `
  SELECT s.*, COUNT(b.id) as book_count
  FROM series s
  LEFT JOIN books b ON b.series_id = s.id
`;

export function createSeries(title: string, description?: string): Series {
  const id = randomUUID();
  const now = new Date().toISOString();
  getDb()
    .prepare(`INSERT INTO series (id, title, description, created_at) VALUES (?, ?, ?, ?)`)
    .run(id, title, description ?? null, now);
  return rowToSeries(
    getDb()
      .prepare(`${SERIES_SELECT} WHERE s.id = ? GROUP BY s.id`)
      .get(id) as SeriesRow,
  );
}

export function listSeries(): Series[] {
  return (
    getDb()
      .prepare(`${SERIES_SELECT} GROUP BY s.id ORDER BY s.created_at DESC`)
      .all() as SeriesRow[]
  ).map(rowToSeries);
}

export function getSeries(id: string): Series | undefined {
  const row = getDb()
    .prepare(`${SERIES_SELECT} WHERE s.id = ? GROUP BY s.id`)
    .get(id) as SeriesRow | undefined;
  return row ? rowToSeries(row) : undefined;
}

export function deleteSeries(id: string): void {
  getDb().prepare(`DELETE FROM series WHERE id = ?`).run(id);
}

export function renameSeries(id: string, title: string): Series | undefined {
  getDb().prepare(`UPDATE series SET title = ? WHERE id = ?`).run(title, id);
  return getSeries(id);
}

export function saveSeriesAbstract(seriesId: string, abstract: string): void {
  getDb()
    .prepare(`UPDATE series SET abstract = ?, abstracted_at = ? WHERE id = ?`)
    .run(abstract, new Date().toISOString(), seriesId);
}
