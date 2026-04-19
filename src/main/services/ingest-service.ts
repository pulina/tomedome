import { readFileSync, statSync } from 'fs';
import { basename } from 'path';
import safeRegex from 'safe-regex2';
// franc-min is ESM-only; lazy dynamic import keeps the CJS main bundle happy
let _franc: ((text: string) => string) | null = null;
async function getFranc(): Promise<(text: string) => string> {
  if (!_franc) {
    const m = await import('franc-min');
    _franc = m.franc;
  }
  return _franc;
}
import type { BookStats, ChunkingOptions } from '../../shared/types';

// ISO 639-3 → display name for the most common languages
const ISO_TO_NAME: Record<string, string> = {
  eng: 'English', pol: 'Polish', deu: 'German', fra: 'French', spa: 'Spanish',
  ita: 'Italian', por: 'Portuguese', rus: 'Russian', nld: 'Dutch', swe: 'Swedish',
  nor: 'Norwegian', dan: 'Danish', fin: 'Finnish', ces: 'Czech', slk: 'Slovak',
  hun: 'Hungarian', ukr: 'Ukrainian', ron: 'Romanian', bul: 'Bulgarian', hrv: 'Croatian',
  zho: 'Chinese', jpn: 'Japanese', kor: 'Korean', ara: 'Arabic', hin: 'Hindi',
  tur: 'Turkish', vie: 'Vietnamese', ind: 'Indonesian', tha: 'Thai', heb: 'Hebrew',
};

export interface RawChunk {
  chapterNumber: number | null;
  chapterTitle: string | null;
  paragraphIndex: number;
  rawText: string;
  tokenCount: number;
}

/** Drop noise fragments; ~3 chars/token heuristic. */
const MIN_TOKENS = 3;
/** Default chunk ceiling (~2400 chars); allows long paragraphs split at sentences without targeting a fixed tokenizer window. */
const MAX_TOKENS = 600;

function countTokens(text: string): number {
  // ~4 chars per token for English prose — good enough without a full tokeniser
  return Math.ceil(text.length / 4);
}

/** Regex used when no chapterPatterns are supplied in ChunkingOptions. */
const DEFAULT_CHAPTER_PATTERNS: RegExp[] = [
  /^#{1,3}\s+\S/,               // Markdown headings (## Title)
  /^(?=.*[A-Z])[^a-z]{1,200}$/, // ALL-CAPS line (no lowercase, at least one uppercase letter)
];

/** Guard regex compilation from huge user strings. */
const MAX_USER_PATTERN_LENGTH = 256;
/** Cap how many user-supplied patterns we compile per option. */
const MAX_USER_PATTERN_COUNT = 32;

const MAX_PLAIN_TEXT_BYTES = 100 * 1024 * 1024;

function readPlainTextFile(filePath: string): string {
  const size = statSync(filePath).size;
  if (size > MAX_PLAIN_TEXT_BYTES) {
    throw new Error(`File exceeds ${MAX_PLAIN_TEXT_BYTES / (1024 * 1024)} MB limit`);
  }
  const buf = readFileSync(filePath);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf);
  } catch {
    throw new Error(
      'Text file is not valid UTF-8. Convert the file to UTF-8 before importing.',
    );
  }
}

function compilePatterns(patterns: string[], flags = ''): RegExp[] {
  const slice = patterns.slice(0, MAX_USER_PATTERN_COUNT);
  return slice.flatMap((p) => {
    const trimmedPattern = p.trim();
    if (!trimmedPattern || trimmedPattern.length > MAX_USER_PATTERN_LENGTH) return [];
    if (!safeRegex(trimmedPattern)) return [];
    try {
      return [new RegExp(trimmedPattern, flags)];
    } catch {
      return [];
    }
  });
}

function detectChapter(line: string, patterns: RegExp[]): string | null {
  // Skip markdown inline formatting (e.g. **BOLD** or *italic*) before any check
  if (/^[*_]/.test(line)) return null;
  for (const p of patterns) {
    if (p.test(line)) {
      // Strip markdown heading markers if present — safe no-op for plain-text lines
      return line.replace(/^#+\s+/, '').trim();
    }
  }
  return null;
}

export async function parseFile(filePath: string, options?: ChunkingOptions): Promise<string> {
  if (filePath.toLowerCase().endsWith('.epub')) {
    const { parseEpub } = await import('./epub-service');
    return parseEpub(filePath, options?.epubOptions);
  }
  return readPlainTextFile(filePath);
}

/**
 * Split plain text into chunks: paragraph breaks from blank lines / section rules,
 * then oversized paragraphs split on sentence boundaries; optional merge pass
 * combines tiny trailing pieces within a chapter.
 */
export function chunkText(text: string, options?: ChunkingOptions): RawChunk[] {
  const chapterPatterns: RegExp[] =
    options?.chapterPatterns !== undefined
      ? compilePatterns(options.chapterPatterns, 'i')
      : DEFAULT_CHAPTER_PATTERNS;

  const sectionSeparators: RegExp[] = compilePatterns(options?.sectionSeparators ?? []);
  const minTokens = options?.minTokens ?? MIN_TOKENS;
  const maxTokens = options?.maxTokens ?? MAX_TOKENS;

  const lines = text.split('\n');
  const paragraphs: string[] = [];
  let current: string[] = [];
  let currentChapter: string | null = null;
  const chapterByParagraph: (string | null)[] = [];
  const chapterNumberByParagraph: (number | null)[] = [];
  let chapterCount = 0;

  for (const line of lines) {
    const chapterName = detectChapter(line.trim(), chapterPatterns);
    if (chapterName) {
      // Flush current paragraph before new chapter
      if (current.length > 0) {
        paragraphs.push(current.join('\n').trim());
        chapterByParagraph.push(currentChapter);
        chapterNumberByParagraph.push(chapterCount || null);
        current = [];
      }
      chapterCount++;
      currentChapter = chapterName;
      continue;
    }

    const isBreak =
      line.trim() === '' ||
      (sectionSeparators.length > 0 && sectionSeparators.some((p) => p.test(line.trim())));
    if (isBreak) {
      if (current.length > 0) {
        paragraphs.push(current.join('\n').trim());
        chapterByParagraph.push(currentChapter);
        chapterNumberByParagraph.push(chapterCount || null);
        current = [];
      }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) {
    paragraphs.push(current.join('\n').trim());
    chapterByParagraph.push(currentChapter);
    chapterNumberByParagraph.push(chapterCount || null);
  }

  const chunks: RawChunk[] = [];
  let index = 0;
  for (let i = 0; i < paragraphs.length; i++) {
    const currentParagraph = paragraphs[i];
    if (!currentParagraph) continue;
    const tokens = countTokens(currentParagraph);
    if (tokens < minTokens) continue; // skip tiny fragments
    if (tokens > maxTokens) {
      // Split long paragraphs into sentence-boundary chunks
      const sentences = currentParagraph.match(/[^.!?]+[.!?]+/g) ?? [currentParagraph];
      let buf = '';
      for (const s of sentences) {
        if (countTokens(buf + s) > maxTokens && buf) {
          chunks.push({
            chapterNumber: chapterNumberByParagraph[i] ?? null,
            chapterTitle: chapterByParagraph[i] ?? null,
            paragraphIndex: index++,
            rawText: buf.trim(),
            tokenCount: countTokens(buf.trim()),
          });
          buf = s;
        } else {
          buf += s;
        }
      }
      if (buf.trim() && countTokens(buf.trim()) >= minTokens) {
        chunks.push({
          chapterNumber: chapterNumberByParagraph[i] ?? null,
          chapterTitle: chapterByParagraph[i] ?? null,
          paragraphIndex: index++,
          rawText: buf.trim(),
          tokenCount: countTokens(buf.trim()),
        });
      }
    } else {
      chunks.push({
        chapterNumber: chapterNumberByParagraph[i] ?? null,
        chapterTitle: chapterByParagraph[i] ?? null,
        paragraphIndex: index++,
        rawText: currentParagraph,
        tokenCount: tokens,
      });
    }
  }
  const mergeThreshold = options?.mergeThreshold ?? 0;
  return mergeThreshold > 0 ? mergeSmallChunks(chunks, mergeThreshold) : chunks;
}

function mergeSmallChunks(chunks: RawChunk[], threshold: number): RawChunk[] {
  const result: RawChunk[] = [];
  for (const chunk of chunks) {
    const lastIdx = result.length - 1;
    const last = lastIdx >= 0 ? result[lastIdx] : undefined;
    if (last && last.tokenCount < threshold && last.chapterNumber === chunk.chapterNumber) {
      result[lastIdx] = {
        chapterNumber: last.chapterNumber,
        chapterTitle: last.chapterTitle,
        paragraphIndex: last.paragraphIndex,
        rawText: last.rawText + '\n\n' + chunk.rawText,
        tokenCount: last.tokenCount + chunk.tokenCount,
      };
    } else {
      result.push({ ...chunk });
    }
  }
  return result.map((c, i) => ({ ...c, paragraphIndex: i }));
}

export function getPreviewStats(filePath: string, chunks: RawChunk[]): BookStats {
  const tokenCounts = chunks.map((c) => c.tokenCount);
  const tokenMin = Math.min(...tokenCounts);
  const tokenMax = Math.max(...tokenCounts);
  const tokenTotal = tokenCounts.reduce((a, b) => a + b, 0);
  const wordCount = chunks.reduce((a, c) => a + c.rawText.split(/\s+/).length, 0);

  // abstract_generation: section_detailed + section_short per section + 1 book call.
  // Count distinct section keys including null (preamble chunks form their own section).
  const sectionCount = new Set(chunks.map((c) => c.chapterNumber)).size;
  const chapterCount = Math.max(sectionCount, 1);
  const estimatedAbstractCalls = chapterCount * 2 + 1;

  return {
    chunkCount: chunks.length,
    tokenMin,
    tokenMax,
    tokenTotal,
    chapterCount,
    wordCount,
    estimatedAbstractCalls,
    chunks: chunks.map((c, i) => ({
      index: i,
      chapterNumber: c.chapterNumber,
      chapterTitle: c.chapterTitle,
      tokenCount: c.tokenCount,
      rawText: c.rawText,
    })),
  };
}

/**
 * Detect the human language of a book from its chunk texts.
 * Uses the first ~2 000 chars of actual content (skips tiny fragments).
 * Falls back to "English" when franc returns "und" (undetermined).
 */
export async function detectLanguage(chunks: RawChunk[]): Promise<string> {
  let sample = '';
  for (const c of chunks) {
    sample += c.rawText + ' ';
    if (sample.length >= 2000) break;
  }
  const franc = await getFranc();
  const code = franc(sample.trim());
  return ISO_TO_NAME[code] ?? 'English';
}

export function titleFromFilename(filePath: string): string {
  return basename(filePath)
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}
