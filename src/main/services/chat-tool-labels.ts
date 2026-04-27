import type { LlmCall } from '@shared/types';
import { getBook } from './book-service';

export function toolLabelForToolCall(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_book_abstract': {
      const book = getBook(args['book_id'] as string);
      return `Read book abstract: ${book?.title ?? args['book_id']}`;
    }
    case 'read_chapter_abstract': {
      const book = getBook(args['book_id'] as string);
      return `Read chapter ${args['chapter_number'] ?? '?'} abstract${book ? ` — ${book.title}` : ''}`;
    }
    case 'read_chapter_detailed': {
      const book = getBook(args['book_id'] as string);
      return `Read chapter ${args['chapter_number'] ?? '?'} detailed${book ? ` — ${book.title}` : ''}`;
    }
    case 'read_chunk_window':
      return 'Expand chunk context';
    case 'list_chapters': {
      const book = getBook(args['book_id'] as string);
      return `List chapters — ${book?.title ?? args['book_id']}`;
    }
    case 'search_text':
      return `Search text: "${args['query']}"`;
    case 'search_semantic':
      return `Search semantic: "${args['query']}"`;
    default:
      return name;
  }
}

export function toolLabelFromLlmToolCallRow(row: LlmCall): string {
  try {
    const j = JSON.parse(row.requestJson) as { tool?: string; arguments?: Record<string, unknown> };
    const name = j.tool ?? row.model ?? 'tool';
    return toolLabelForToolCall(name, j.arguments ?? {});
  } catch {
    return row.model ?? 'tool';
  }
}
