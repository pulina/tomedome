import type { Book, ChatContextAvailability } from '../../shared/types';
import { bookEmbeddingProfileMismatch } from '@shared/embedding-profile';
import { listBooks } from '../services/book-service';
import { getEmbeddingModel, getEmbeddingPassagePrefix } from '../services/config-service';
import { listSeries } from '../services/series-service';

function hasMismatch(book: Book, currentEmbeddingModel: string | null, currentPassagePrefix: string): boolean {
  return bookEmbeddingProfileMismatch(book, currentEmbeddingModel, currentPassagePrefix);
}

export function getChatContextAvailability(seriesId?: string | null): ChatContextAvailability {
  const allBooks = listBooks();
  const seriesList = listSeries();
  const currentEmbeddingModel = getEmbeddingModel() || null;
  const currentPassagePrefix = getEmbeddingPassagePrefix();

  if (seriesId) {
    const series = seriesList.find((s) => s.id === seriesId);
    if (!series) {
      return {
        bookCount: 0,
        seriesAbstractMissingCount: 0,
        seriesAbstractNotApplicable: true,
        seriesBucketCount: 0,
        bookAbstractMissingCount: 0,
        ragEligibleBookCount: 0,
        ragEmbeddingMissingCount: 0,
        ragProfileMismatchCount: 0,
        seriesScoped: true,
      };
    }
    const books = allBooks.filter((b) => b.seriesId === seriesId);
    const ragEligibleBookCount = books.filter((b) => b.chunkCount > 0).length;
    return {
      bookCount: books.length,
      seriesAbstractMissingCount: !series.abstract || !series.abstract.trim() ? 1 : 0,
      seriesAbstractNotApplicable: false,
      seriesBucketCount: books.length > 0 ? 1 : 0,
      bookAbstractMissingCount: books.filter((b) => !b.abstractedAt).length,
      ragEligibleBookCount,
      ragEmbeddingMissingCount: books.filter((b) => b.chunkCount > 0 && !b.embeddedAt).length,
      ragProfileMismatchCount: books.filter((b) => hasMismatch(b, currentEmbeddingModel, currentPassagePrefix)).length,
      seriesScoped: true,
    };
  }

  const seriesWithBooks = seriesList.filter((s) => s.bookCount > 0);
  const seriesAbstractMissingCount = seriesWithBooks.filter(
    (s) => !s.abstract || !s.abstract.trim(),
  ).length;
  const ragEligibleBookCount = allBooks.filter((b) => b.chunkCount > 0).length;

  return {
    bookCount: allBooks.length,
    seriesAbstractMissingCount,
    seriesAbstractNotApplicable: seriesWithBooks.length === 0,
    seriesBucketCount: seriesWithBooks.length,
    bookAbstractMissingCount: allBooks.filter((b) => !b.abstractedAt).length,
    ragEligibleBookCount,
    ragEmbeddingMissingCount: allBooks.filter((b) => b.chunkCount > 0 && !b.embeddedAt).length,
    ragProfileMismatchCount: allBooks.filter((b) => hasMismatch(b, currentEmbeddingModel, currentPassagePrefix)).length,
    seriesScoped: false,
  };
}
