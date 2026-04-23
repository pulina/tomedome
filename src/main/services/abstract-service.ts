import {
  getBook,
  getChunks,
  getAbstracts,
  listBooksBySeries,
  markBookAbstracted,
  saveAbstract,
  type ChunkRow,
} from './book-service';
import { abstractEmbeddingProfileBlockedReason, runAbstractEmbeddingGeneration } from './embedding-service';
import { setJobStarted, updateProgress } from './job-queue';
import { generateStructured } from './llm-client';
import { getAbstractConfig, getLlmConfig } from './config-service';
import { saveSeriesAbstract } from './series-service';
import { getLogger } from '../lib/logger';
import abstractDetailedPrompt from '../prompts/abstract-detailed.md?raw';
import abstractShortPrompt from '../prompts/abstract-short.md?raw';
import abstractBookPrompt from '../prompts/abstract-book.md?raw';
import abstractSeriesPrompt from '../prompts/abstract-series.md?raw';

const DETAIL_INSTRUCTIONS: Record<number, string> = {
  1: 'Be concise — focus on the most essential plot points only.',
  2: '',
  3: 'Be exhaustive — do not skip any named character, decision, significant object, or location. Include dialogue outcomes and consequences. The more detail, the better.',
};

/**
 * Fill a prompt template.
 * Supported placeholders:
 *   {{LANG_INSTRUCTION}}   — "You MUST respond in <language>…\n" or "" when no language set
 *   {{DETAIL_INSTRUCTION}} — length/detail guidance from detailLevel (1–3), or "" for default
 *   {{TEXT}}               — the content to process
 */
function buildPrompt(
  template: string,
  text: string,
  language: string | undefined,
  detailLevel: number,
): string {
  const langInstruction = language ? `You MUST respond in ${language}. Do not use any other language.\n` : '';
  const detailInstruction = DETAIL_INSTRUCTIONS[detailLevel] ?? '';
  return template
    .replace('{{TEXT}}', text)
    .replace('{{LANG_INSTRUCTION}}\n', langInstruction)
    .replace('{{LANG_INSTRUCTION}}', langInstruction.trimEnd())
    .replace('{{DETAIL_INSTRUCTION}}\n', detailInstruction ? detailInstruction + '\n' : '')
    .replace('{{DETAIL_INSTRUCTION}}', detailInstruction)
    .trimStart()
    .trimEnd();
}

const ABSTRACT_SCHEMA = {
  type: 'object',
  properties: { abstract: { type: 'string' } },
  required: ['abstract'],
  additionalProperties: false,
} as const;

async function summarizeSectionToShortAbstract(params: {
  jobId: string;
  bookId: string;
  signal: AbortSignal;
  sectionNumber: number | null;
  sectionTitle: string | null;
  sectionLabel: string;
  sectionText: string;
  language: string | undefined;
  detailLevel: number;
  abstractCfg: ReturnType<typeof getAbstractConfig>;
  step: { current: number };
  totalSteps: number;
  savedCount: { value: number };
}): Promise<string | null> {
  const {
    jobId,
    bookId,
    signal,
    sectionNumber,
    sectionTitle,
    sectionLabel,
    sectionText,
    language,
    detailLevel,
    abstractCfg,
    step,
    totalSteps,
    savedCount,
  } = params;

  step.current++;
  updateProgress(jobId, step.current, totalSteps, `${sectionLabel} — detailed`);
  if (signal.aborted) return null;

  const detailedResult = await generateStructured<{ abstract: string }>({
    messages: [
      {
        role: 'user',
        content: buildPrompt(abstractDetailedPrompt, sectionText, language, detailLevel),
      },
    ],
    schemaName: 'abstract_detailed',
    schema: ABSTRACT_SCHEMA,
    maxTokens: abstractCfg.maxTokensDetailed,
    purpose: 'abstract',
    abortSignal: signal,
  });

  if (signal.aborted) return null;

  const detailedText = detailedResult.abstract?.trim() ?? '';
  if (detailedText.length < 20) {
    throw new Error(`Model returned empty output for section "${sectionLabel}" (detailed abstract)`);
  }

  saveAbstract(bookId, sectionNumber, sectionTitle, 'chapter_detailed', detailedText);
  savedCount.value++;

  step.current++;
  updateProgress(jobId, step.current, totalSteps, `${sectionLabel} — short`);
  if (signal.aborted) return null;

  const shortResult = await generateStructured<{ abstract: string }>({
    messages: [
      {
        role: 'user',
        content: buildPrompt(abstractShortPrompt, detailedText, language, detailLevel),
      },
    ],
    schemaName: 'abstract_short',
    schema: ABSTRACT_SCHEMA,
    maxTokens: abstractCfg.maxTokensShort,
    purpose: 'abstract',
    abortSignal: signal,
  });

  if (signal.aborted) return null;

  const shortText = shortResult.abstract?.trim() ?? '';
  if (shortText.length < 20) {
    throw new Error(`Model returned empty output for section "${sectionLabel}" (short abstract)`);
  }

  saveAbstract(bookId, sectionNumber, sectionTitle, 'chapter_short', shortText);
  return shortText;
}

/**
 * Bottom-up abstract generation pipeline.
 *
 * For each section group: detailed summary → short summary
 * Then: all short summaries → full-work overview
 *
 * Prompts live in src/main/prompts/ and can be edited without touching this file.
 * Checks signal.aborted before every LLM call so cancel is near-instant.
 */
export async function runAbstractGeneration(
  jobId: string,
  bookId: string,
  signal: AbortSignal,
  opts?: { skipFinalAbstractEmbedding?: boolean },
): Promise<void> {
  const chunks = getChunks(bookId);
  if (chunks.length === 0) return;

  const blocked = abstractEmbeddingProfileBlockedReason(bookId);
  if (blocked) throw new Error(blocked);

  const { model } = getLlmConfig();
  const abstractCfg = getAbstractConfig();
  const detailLevel = abstractCfg.detailLevel;
  setJobStarted(jobId, model ?? 'unknown');

  const book = getBook(bookId);
  const language = book?.language ?? undefined;

  // Group chunks by section (chapter_number key)
  const sectionMap = new Map<number | null, ChunkRow[]>();
  for (const chunk of chunks) {
    const key = chunk.chapter_number;
    if (!sectionMap.has(key)) sectionMap.set(key, []);
    sectionMap.get(key)!.push(chunk);
  }

  const sections = Array.from(sectionMap.entries());
  // Total steps: detailed + short per section + 1 full-work abstract
  const totalSteps = sections.length * 2 + 1;
  const step = { current: 0 };

  const shortAbstracts: string[] = [];
  const savedCount = { value: 0 };

  for (const [sectionNumber, sectionChunks] of sections) {
    if (signal.aborted) return;

    const sectionLabel =
      sectionChunks[0]?.chapter_title ?? `Section ${sectionNumber ?? '?'}`;
    const sectionTitle = sectionChunks[0]?.chapter_title ?? null;
    const sectionText = sectionChunks.map((c) => c.raw_text).join('\n\n');
    if (!sectionText.trim()) {
      getLogger().warn(
        { bookId, sectionNumber, chunkCount: sectionChunks.length },
        'Section skipped: all chunks have empty raw_text',
      );
      continue;
    }

    const shortText = await summarizeSectionToShortAbstract({
      jobId,
      bookId,
      signal,
      sectionNumber,
      sectionTitle,
      sectionLabel,
      sectionText,
      language,
      detailLevel,
      abstractCfg,
      step,
      totalSteps,
      savedCount,
    });
    if (shortText === null) return;
    shortAbstracts.push(shortText);
  }

  if (shortAbstracts.length > 0) {
    step.current++;
    updateProgress(jobId, step.current, totalSteps, 'Full-work overview');
    if (signal.aborted) return;

    const bookResult = await generateStructured<{ abstract: string }>({
      messages: [
        {
          role: 'user',
          content: buildPrompt(abstractBookPrompt, shortAbstracts.join('\n\n'), language, detailLevel),
        },
      ],
      schemaName: 'abstract_book',
      schema: ABSTRACT_SCHEMA,
      maxTokens: abstractCfg.maxTokensBook,
      purpose: 'abstract',
      abortSignal: signal,
    });

    if (signal.aborted) return;

    const bookText = bookResult.abstract?.trim() ?? '';
    if (bookText.length < 20) {
      throw new Error('Model returned empty output for full-work overview');
    }

    saveAbstract(bookId, null, null, 'book', bookText);
    savedCount.value++;
  }

  if (!signal.aborted && savedCount.value > 0) {
    markBookAbstracted(bookId);
    if (!opts?.skipFinalAbstractEmbedding) await runAbstractEmbeddingGeneration(bookId, signal);
  }
}

/**
 * Generate a series-level overview abstract from all book-level abstracts.
 * Silently skips if fewer than one book has a book-level abstract.
 * Fire-and-forget safe — does not throw on empty input.
 */
export async function runSeriesAbstractGeneration(
  seriesId: string,
  signal: AbortSignal,
): Promise<void> {
  const books = listBooksBySeries(seriesId);
  const entries: string[] = [];

  for (const book of books) {
    const abstracts = getAbstracts(book.id);
    const bookAbstract = abstracts.find((a) => a.level === 'book');
    if (bookAbstract) {
      entries.push(`## ${book.title}\n${bookAbstract.content}`);
    }
  }

  if (entries.length === 0) return;

  const abstractCfg = getAbstractConfig();
  const language = books.find((b) => b.language)?.language ?? undefined;

  if (signal.aborted) return;

  const result = await generateStructured<{ abstract: string }>({
    messages: [
      {
        role: 'user',
        content: buildPrompt(abstractSeriesPrompt, entries.join('\n\n'), language, abstractCfg.detailLevel),
      },
    ],
    schemaName: 'abstract_series',
    schema: ABSTRACT_SCHEMA,
    maxTokens: 2000,
    purpose: 'abstract',
    abortSignal: signal,
  });

  if (signal.aborted) return;

  const text = result.abstract?.trim() ?? '';
  if (text.length >= 20) {
    saveSeriesAbstract(seriesId, text);
  }
}
