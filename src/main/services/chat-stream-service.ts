import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  addMessage,
  getChat,
  getMessages,
  setChatTitle,
} from './chat-service';
import { listBooks, getAbstracts, getBook, getChunkWindow, listChapters, annotateChapterSplits } from './book-service';
import { searchChunksFts } from './vector-store';
import { listSeries } from './series-service';
import { ChatTurn, resolveToolCalls } from './llm-client';
import type { AgentMessage, ToolDefinition } from './llm-client';
import {
  buildRagContext,
  isSemanticRetrievalOperational,
  searchSemanticForTool,
  type RagContext,
} from './rag-service';
import chatSystemBase from '../prompts/chat-system.md?raw';
import { getLogger } from '../lib/logger';
import { toolLabelForToolCall } from './chat-tool-labels';

const CHUNK_WINDOW_MAX = 10;

function formatChunkLabel(chapterNumber: number | null | undefined, chapterTitle: string | null | undefined): string {
  if (chapterTitle) return `Chapter ${chapterNumber ?? '?'}: ${chapterTitle}`;
  if (chapterNumber != null) return `Chapter ${chapterNumber}`;
  return 'Unknown chapter';
}

type RagHit = { bookTitle: string; chapterNumber: number | null; chapterTitle: string | null; chunkId: string; text: string };

function formatRagHits(hits: RagHit[], heading: string): string {
  const lines: string[] = [`## ${heading}\n`];
  for (const hit of hits) {
    lines.push(`### "${hit.bookTitle}" — ${formatChunkLabel(hit.chapterNumber, hit.chapterTitle)} [chunk: ${hit.chunkId}]\n${hit.text}`);
  }
  return lines.join('\n\n');
}

const BOOK_TOOLS: ToolDefinition[] = [
  {
    name: 'read_book_abstract',
    description: 'Returns the book-level abstract plus a numbered list of its chapters.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'The book ID from the library context.' },
      },
      required: ['book_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_chapter_abstract',
    description: 'Returns the 2–5 sentence summary of a specific chapter.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'The book ID.' },
        chapter_number: { type: 'number', description: 'The chapter number.' },
      },
      required: ['book_id', 'chapter_number'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_chapter_detailed',
    description:
      'Returns the full detailed summary of a specific chapter, including all named characters, events, and decisions.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'The book ID.' },
        chapter_number: { type: 'number', description: 'The chapter number.' },
      },
      required: ['book_id', 'chapter_number'],
      additionalProperties: false,
    },
  },
  {
    name: 'read_chunk_window',
    description:
      'Returns the surrounding raw text chunks for a given chunk ID. Use when a retrieved passage seems to cut off mid-scene or mid-dialogue and you need the immediate context before or after it.',
    parameters: {
      type: 'object',
      properties: {
        chunk_id: {
          type: 'string',
          description: 'The chunk ID shown in brackets after a passage header, e.g. [chunk: abc-123].',
        },
        before: {
          type: 'number',
          description: 'Number of chunks to include before the anchor. Default 2.',
        },
        after: {
          type: 'number',
          description: 'Number of chunks to include after the anchor. Default 2.',
        },
      },
      required: ['chunk_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'list_chapters',
    description:
      'Returns all chapters of a book as a numbered list with their titles. Use this to resolve a chapter reference before calling read_chapter_abstract or read_chapter_detailed — especially when the user refers to a chapter by name rather than number, or when multiple chapters could share the same name.',
    parameters: {
      type: 'object',
      properties: {
        book_id: { type: 'string', description: 'The book ID.' },
      },
      required: ['book_id'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_text',
    description:
      'Keyword search over all ingested text. Use when you know a specific word, name, or phrase that must appear verbatim — character names, place names, quoted fragments, unique terminology. Supports FTS5 syntax (AND, OR, NOT, "phrase", prefix*).' +
      ' IMPORTANT — query strategy: FTS5 matches ALL terms within the same chunk, so multi-word queries almost always return nothing. Always search for a single distinctive keyword first.' +
      ' Use the prefix wildcard for partial matches: "Thane*" matches "Thanedd", "Dijkst*" matches "Dijkstra". If a query returns nothing: (1) retry with a prefix variant using *; (2) try an inflected form of the word; (3) fall back to search_semantic.' +
      ' IMPORTANT — scope: omitting book_id searches the entire library. When a question is about a series, always try without book_id first — the relevant passage may be in a different volume than you assumed. Only restrict to a specific book_id when the user explicitly asks about that book.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A single keyword or short exact phrase. Prefix matching is applied automatically — "Thane" will find "Thanedd". Avoid multi-word queries — they rarely match.',
        },
        book_id: {
          type: 'string',
          description: 'Optional. Omit to search all books in scope. Only set when the user explicitly targets a specific book.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    name: 'search_semantic',
    description:
      'Semantic (embedding) search over all ingested text. Use when you need passages about a concept, description, or scene but cannot predict the exact words — e.g. "creature physical appearance", "battle at the castle gates". Complements search_text: use search_text for known verbatim words, use search_semantic for conceptual or descriptive queries.',
    parameters: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'A descriptive phrase capturing what you are looking for conceptually.',
        },
        book_id: {
          type: 'string',
          description: 'Optional. Omit to search the entire library. Only set when the user explicitly targets a specific book.',
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
];

function bookToolsForChat(semanticOk: boolean): ToolDefinition[] {
  if (semanticOk) return BOOK_TOOLS;
  return BOOK_TOOLS.filter((t) => t.name !== 'search_semantic');
}

async function executeTool(
  name: string,
  args: Record<string, unknown>,
  seriesId: string | null,
): Promise<string> {
  switch (name) {
    case 'read_book_abstract': {
      const book = getBook(args['book_id'] as string);
      if (!book) return 'Book not found.';
      const abstracts = getAbstracts(book.id);
      const bookAbstract = abstracts.find((a) => a.level === 'book');

      const seen = new Set<number>();
      const chapters = abstracts
        .filter((a) => a.chapterNumber !== null && !seen.has(a.chapterNumber!) && seen.add(a.chapterNumber!))
        .sort((a, b) => (a.chapterNumber ?? 0) - (b.chapterNumber ?? 0))
        .map((a) => `  ${a.chapterNumber}. ${a.chapterTitle ?? 'Untitled'}`);

      const parts: string[] = [];
      if (bookAbstract) parts.push(bookAbstract.content);
      else parts.push('No book-level abstract available yet.');
      if (chapters.length > 0) parts.push(`Chapters:\n${chapters.join('\n')}`);
      return parts.join('\n\n');
    }

    case 'read_chapter_abstract': {
      const abstracts = getAbstracts(args['book_id'] as string);
      const chap = abstracts.find(
        (a) => a.level === 'chapter_short' && a.chapterNumber === args['chapter_number'],
      );
      return chap?.content ?? 'No short abstract available for this chapter.';
    }

    case 'read_chapter_detailed': {
      const abstracts = getAbstracts(args['book_id'] as string);
      const chap = abstracts.find(
        (a) => a.level === 'chapter_detailed' && a.chapterNumber === args['chapter_number'],
      );
      return chap?.content ?? 'No detailed abstract available for this chapter.';
    }

    case 'read_chunk_window': {
      const before = Math.min(Math.max(Math.round((args['before'] as number | undefined) ?? 2), 0), CHUNK_WINDOW_MAX);
      const after = Math.min(Math.max(Math.round((args['after'] as number | undefined) ?? 2), 0), CHUNK_WINDOW_MAX);
      const result = getChunkWindow(args['chunk_id'] as string, before, after);
      if (!result) return 'Chunk not found.';

      const lines: string[] = [`## Surrounding context — "${result.bookTitle}"\n`];
      for (const chunk of result.chunks) {
        const isAnchor = chunk.paragraph_index === result.anchorIndex;
        const marker = isAnchor ? ' ← retrieved chunk' : '';
        lines.push(`### ${formatChunkLabel(chunk.chapter_number, chunk.chapter_title)}${marker} [chunk: ${chunk.id}]\n${chunk.raw_text}`);
      }
      return lines.join('\n\n');
    }

    case 'list_chapters': {
      const book = getBook(args['book_id'] as string);
      if (!book) return 'Book not found.';
      const annotated = annotateChapterSplits(listChapters(book.id));
      if (annotated.length === 0) return 'No chapter data available for this book yet.';

      const lines = annotated.map((c) => {
        const title = c.chapterTitle ?? '(untitled)';
        return `  ${c.chapterNumber}. ${title}${c.partLabel ? ` ${c.partLabel}` : ''}`;
      });
      return `Chapters of "${book.title}":\n${lines.join('\n')}`;
    }

    case 'search_text': {
      const query = (args['query'] as string).trim();
      const rawBookId = args['book_id'] as string | undefined;
      const bookId = rawBookId?.trim() ? rawBookId.trim() : null;
      if (!query) return 'Query must not be empty.';
      if (bookId && !getBook(bookId)) return `Book id "${bookId}" does not exist in the library. Use only book ids listed in the Library section of your context.`;

      const hits = searchChunksFts(query, 8, seriesId, bookId);
      if (hits.length === 0) return 'No passages found matching that query.';
      return formatRagHits(hits, `Search results for "${query}"`);
    }

    case 'search_semantic': {
      const query = (args['query'] as string).trim();
      const rawBookId = args['book_id'] as string | undefined;
      const bookId = rawBookId?.trim() ? rawBookId.trim() : null;
      if (bookId && !getBook(bookId)) return `Book id "${bookId}" does not exist in the library. Use only book ids listed in the Library section of your context.`;
      if (!query) return 'Query must not be empty.';

      let hits: Awaited<ReturnType<typeof searchSemanticForTool>>;
      try {
        hits = await searchSemanticForTool(query, 6, bookId, seriesId);
      } catch (err) {
        return `Semantic search failed: ${err instanceof Error ? err.message : String(err)}`;
      }

      if (hits === null) {
        return (
          'Semantic search is unavailable in this chat scope (no embedding API and/or no chunk vectors matching the current embedding profile). ' +
          'Use search_text for verbatim keyword search and read_book_abstract, read_chapter_abstract, read_chapter_detailed, or list_chapters for narrative context.'
        );
      }
      if (hits.length === 0) return 'No passages found matching that query.';
      return formatRagHits(hits, `Semantic search results for "${query}"`);
    }

    default:
      return `Unknown tool: ${name}`;
  }
}

/**
 * Strips the leading <title>...</title> tag from a model response.
 * Returns the extracted title (or null if absent/Unknown) and the cleaned content.
 */
function extractTitleTag(text: string): { title: string | null; content: string } {
  const match = text.match(/^\s*<title>([\s\S]*?)<\/title>\s*/);
  if (!match) return { title: null, content: text };
  const raw = match[1]?.trim() ?? '';
  const title = !raw || raw === 'Unknown' ? null : raw.slice(0, 80);
  return { title, content: text.slice(match[0].length) };
}

function buildSystemPrompt(seriesId: string | null, semanticOk: boolean, currentTitle: string | null): string {
  const allSeries = listSeries();
  const allBooks = listBooks();

  const visibleSeries = seriesId ? allSeries.filter((s) => s.id === seriesId) : allSeries;
  const visibleBooks = seriesId ? allBooks.filter((b) => b.seriesId === seriesId) : allBooks;

  let base: string;

  if (visibleBooks.length === 0) {
    base =
      chatSystemBase +
      '\n\n## Library\n\nThe library is currently empty. Inform the user and suggest adding books via the Library tab.';
  } else {
    const sections: string[] = [chatSystemBase, '## Library'];

    for (const series of visibleSeries) {
      const books = visibleBooks.filter((b) => b.seriesId === series.id);
      books.sort((a, b) => (a.seriesOrder ?? 999999) - (b.seriesOrder ?? 999999));
      if (books.length === 0) continue;

      sections.push(`\n### ${series.title} (series id: \`${series.id}\`)`);

      if (series.abstract) {
        sections.push(series.abstract);
      }

      const bookLines = books.map((b, idx) => {
        const pos =
          books.length > 1 ? `${b.seriesOrder ?? idx + 1}. ` : '';
        const meta = [b.author, b.year ? String(b.year) : null, b.language ? `language: ${b.language}` : null]
          .filter(Boolean)
          .join(', ');
        const hasAbstract = !!b.abstractedAt;
        return `- ${pos}${b.title} (id: \`${b.id}\`)${meta ? ` — ${meta}` : ''}${hasAbstract ? ' — abstract available' : ' — no abstract yet'}`;
      });
      sections.push(bookLines.join('\n'));
    }

    if (!semanticOk) {
      sections.push(
        '\n## Semantic chunk retrieval unavailable\n\n' +
          'The `search_semantic` tool and automatic semantic RAG on the user message are off: there is no embedding-capable provider/model and/or no chunk embeddings match the current embedding profile for books in this chat scope. ' +
          'Use `search_text` (FTS) for exact words and phrases, and `read_book_abstract`, `read_chapter_abstract`, `read_chapter_detailed`, and `list_chapters` for summaries and structure.',
      );
    }

    if (!seriesId) {
      const orphans = visibleBooks.filter((b) => !b.seriesId || !allSeries.find((s) => s.id === b.seriesId));
      if (orphans.length > 0) {
        sections.push('\n### Unsorted Books');
        sections.push(
          orphans
            .map((b) => `- ${b.title} (id: \`${b.id}\`)${b.abstractedAt ? ' — abstract available' : ''}`)
            .join('\n'),
        );
      }
    }

    base = sections.join('\n');
  }

  if (currentTitle !== null) {
    base +=
      '\n\n## Conversation title' +
      `\n\nCurrent title: "${currentTitle}"` +
      '\n\nBegin every response with a title tag on its own line:' +
      '\n<title>TITLE</title>' +
      '\n\nTitle rules:' +
      '\n- If the current title still accurately describes this conversation: return it unchanged.' +
      '\n- If the current title is "Unknown" and a specific topic has emerged (book, character, theme): generate a 3–6 word Title Case title.' +
      '\n- If the conversation topic has clearly shifted: update to a new 3–6 word Title Case title.' +
      '\n- For pure greetings or no clear topic yet: return "Unknown".';
  }

  return base;
}

export async function streamChatAssistantReply(params: {
  req: FastifyRequest;
  reply: FastifyReply;
  chatId: string;
  content: string;
  seriesId: string | null;
}): Promise<void> {
  const { req, reply, chatId, content, seriesId } = params;

  const chat = getChat(chatId);
  const currentTitle = chat?.title ?? 'Unknown';
  const titleStatus = chat?.titleStatus ?? 'pending';
  const shouldEvalTitle = titleStatus !== 'determined' && titleStatus !== 'locked';

  const userMessage = addMessage(chatId, 'user', content);

  reply.hijack();
  const origin = req.headers.origin ?? '*';
  reply.raw.writeHead(200, {
    'content-type': 'text/event-stream',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
    'access-control-allow-origin': origin,
    'access-control-allow-credentials': 'true',
  });

  const abort = new AbortController();
  reply.raw.on('close', () => abort.abort());

  const rawSocket = reply.raw.socket as { setNoDelay?: (v: boolean) => void } | undefined;
  rawSocket?.setNoDelay?.(true);

  // Drain-aware SSE write. reply.raw.write() returns false when the kernel
  // buffer is full (backpressure); we queue subsequent chunks and flush them
  // on the 'drain' event rather than blowing up the in-process buffer.
  const pending: string[] = [];
  let flushing = false;

  function flushPending(): void {
    flushing = true;
    while (pending.length > 0) {
      const chunk = pending.shift()!;
      const ok = reply.raw.write(chunk);
      if (!ok) {
        reply.raw.once('drain', flushPending);
        return;
      }
    }
    flushing = false;
  }

  const write = (event: string, data: unknown): void => {
    pending.push(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    if (!flushing) flushPending();
  };

  write('user-message', userMessage);

  const keepalive = setInterval(() => {
    if (reply.raw.writableEnded) return;
    pending.push(': keepalive\n\n');
    if (!flushing) flushPending();
  }, 1000);

  // Compute once — used for system prompt, tool list, and RAG guard below.
  const semanticOk = isSemanticRetrievalOperational(seriesId);

  let ragContext: RagContext | null = null;
  try {
    ragContext = await buildRagContext(content, seriesId);
  } catch (err) {
    getLogger().warn({ err, chatId }, 'buildRagContext threw');
  }

  if (ragContext) {
    write('rag_context', { chunkCount: ragContext.chunkIds.length });
  }

  const allMessages = getMessages(chatId);
  const lastCompactionIdx = allMessages.map((m) => m.role).lastIndexOf('compaction');

  // Compaction stores a summary as a synthetic message; we treat it as a checkpoint
  // and only send messages after it (plus a short prefix) so we do not replay the full thread.
  let historyMessages: typeof allMessages;
  let compactionPrefix: ChatTurn[] = [];

  if (lastCompactionIdx >= 0) {
    const compactionMsg = allMessages[lastCompactionIdx]!;
    historyMessages = allMessages.slice(lastCompactionIdx + 1).filter((m) => m.role !== 'compaction');
    compactionPrefix = [
      { role: 'user', content: `[Previous conversation summary]\n\n${compactionMsg.content}` },
      { role: 'assistant', content: 'Understood. Continuing with that context.' },
    ];
  } else {
    historyMessages = allMessages.filter((m) => m.role !== 'compaction');
    compactionPrefix = [];
  }

  const history = historyMessages.map(
    (m): ChatTurn => ({ role: m.role === 'user' ? 'user' : 'assistant', content: m.content }),
  );

  try {
    const systemPrompt = buildSystemPrompt(seriesId, semanticOk, shouldEvalTitle ? currentTitle : null);

    const augmentedHistory: ChatTurn[] = history.map((turn, idx) => {
      if (idx === history.length - 1 && turn.role === 'user' && ragContext) {
        return { role: 'user', content: `${ragContext.contextBlock}\n\n---\n\n${turn.content}` };
      }
      return turn;
    });

    const turns: ChatTurn[] = [{ role: 'system', content: systemPrompt }, ...compactionPrefix, ...augmentedHistory];
    const agentMessages: AgentMessage[] = turns.map((t) => ({
      role: t.role as 'system' | 'user' | 'assistant',
      content: t.content,
    }));

    let responseText = '';
    let llmCallId: string | null = null;
    let streamError: string | null = null;
    let promptTokens: number | null = null;
    let extractedTitle: string | null = null;

    const resolved = await resolveToolCalls({
      messages: agentMessages,
      tools: bookToolsForChat(semanticOk),
      executor: (n, a) => executeTool(n, a, seriesId),
      onToolCall: (name, args) => write('tool_use', { label: toolLabelForToolCall(name, args) }),
      abortSignal: abort.signal,
      chatId,
    });

    if (resolved !== null) {
      const { title, content } = extractTitleTag(resolved.text);
      extractedTitle = title;
      responseText = content || resolved.text;
      llmCallId = resolved.llmCallId;
      promptTokens = resolved.promptTokens;
      if (responseText) write('token', responseText);
    }

    const assistantMessage = addMessage(chatId, 'assistant', responseText, llmCallId, ragContext?.chunkIds ?? []);

    if (shouldEvalTitle && extractedTitle !== null) {
      const msgCount = allMessages.length + 1; // user already in allMessages; assistant just added
      const finalise = msgCount >= 6;
      setChatTitle(chatId, extractedTitle, finalise ? 'determined' : 'pending');
      if (extractedTitle !== currentTitle) {
        write('title', { title: extractedTitle });
      }
    }

    write('done', {
      messageId: assistantMessage.id,
      llmCallId: llmCallId ?? null,
      promptTokens,
      error: streamError,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    getLogger().error({ err, chatId }, 'chat SSE stream failed');
    write('done', {
      messageId: null,
      llmCallId: null,
      promptTokens: null,
      error: msg,
    });
  } finally {
    clearInterval(keepalive);
    if (!reply.raw.writableEnded) reply.raw.end();
  }
}
