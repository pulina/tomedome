import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  addMessage,
  getChat,
  getMessages,
} from './chat-service';
import { listBooks, getAbstracts, getBook } from './book-service';
import { listSeries } from './series-service';
import { ChatTurn, streamChat, resolveToolCalls } from './llm-client';
import type { AgentMessage, ToolDefinition } from './llm-client';
import { evaluateTitle } from './title-service';
import { buildRagContext } from './rag-service';
import chatSystemBase from '../prompts/chat-system.md?raw';
import { getLogger } from '../lib/logger';

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
];

function toolLabel(name: string, args: Record<string, unknown>): string {
  switch (name) {
    case 'read_book_abstract': {
      const book = getBook(args['book_id'] as string);
      return `Read book abstract: ${book?.title ?? args['book_id']}`;
    }
    case 'read_chapter_abstract': {
      const book = getBook(args['book_id'] as string);
      return `Read chapter ${args['chapter_number']} abstract${book ? ` — ${book.title}` : ''}`;
    }
    case 'read_chapter_detailed': {
      const book = getBook(args['book_id'] as string);
      return `Read chapter ${args['chapter_number']} detailed${book ? ` — ${book.title}` : ''}`;
    }
    default:
      return name;
  }
}

async function executeTool(name: string, args: Record<string, unknown>): Promise<string> {
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

    default:
      return `Unknown tool: ${name}`;
  }
}

function buildSystemPrompt(seriesId: string | null): string {
  const allSeries = listSeries();
  const allBooks = listBooks();

  const visibleSeries = seriesId ? allSeries.filter((s) => s.id === seriesId) : allSeries;
  const visibleBooks = seriesId ? allBooks.filter((b) => b.seriesId === seriesId) : allBooks;

  if (visibleBooks.length === 0) {
    return (
      chatSystemBase +
      '\n\n## Library\n\nThe library is currently empty. Inform the user and suggest adding books via the Library tab.'
    );
  }

  const sections: string[] = [chatSystemBase, '## Library'];

  for (const series of visibleSeries) {
    const books = visibleBooks.filter((b) => b.seriesId === series.id);
    if (books.length === 0) continue;

    sections.push(`\n### ${series.title} (series id: \`${series.id}\`)`);

    if (series.abstract) {
      sections.push(series.abstract);
    }

    const bookLines = books.map((b) => {
      const meta = [b.author, b.year ? String(b.year) : null].filter(Boolean).join(', ');
      const hasAbstract = !!b.abstractedAt;
      return `- ${b.title} (id: \`${b.id}\`)${meta ? ` — ${meta}` : ''}${hasAbstract ? ' — abstract available' : ' — no abstract yet'}`;
    });
    sections.push(bookLines.join('\n'));
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

  return sections.join('\n');
}

export async function streamChatAssistantReply(params: {
  req: FastifyRequest;
  reply: FastifyReply;
  chatId: string;
  content: string;
  seriesId: string | null;
}): Promise<void> {
  const { req, reply, chatId, content, seriesId } = params;

  const userMessage = addMessage(chatId, 'user', content);

  const ragContext = await buildRagContext(content, seriesId);

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

  if (ragContext) {
    write('rag_context', { chunkCount: ragContext.chunkIds.length });
  }

  const keepalive = setInterval(() => {
    if (!reply.raw.writableEnded) reply.raw.write(': keepalive\n\n');
  }, 1000);

  try {
    const systemPrompt = buildSystemPrompt(seriesId);

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

    const resolved = await resolveToolCalls({
      messages: agentMessages,
      tools: BOOK_TOOLS,
      executor: executeTool,
      onToolCall: (name, args) => write('tool_use', { label: toolLabel(name, args) }),
      abortSignal: abort.signal,
      chatId,
    });

    if (resolved !== null) {
      responseText = resolved.text;
      llmCallId = resolved.llmCallId;
      promptTokens = resolved.promptTokens;
      if (responseText) write('token', responseText);
    } else {
      const result = await streamChat({
        chatId,
        purpose: 'chat',
        messages: turns,
        abortSignal: abort.signal,
        onToken: (chunk) => write('token', chunk),
      });
      responseText = result.text;
      llmCallId = result.llmCallId;
      streamError = result.error;
      promptTokens = result.promptTokens;
    }

    const assistantMessage = addMessage(chatId, 'assistant', responseText, llmCallId, ragContext?.chunkIds ?? []);

    let newTitle: string | null = null;
    try {
      const msgs = getMessages(chatId);
      newTitle = await evaluateTitle(chatId, msgs);
    } catch (err) {
      getLogger().warn({ err, chatId }, 'title evaluation threw');
    }

    if (newTitle) write('title', { title: newTitle });
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
