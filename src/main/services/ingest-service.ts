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
import {
  DEFAULT_MAX_PARAGRAPHS_PER_CHAPTER_SECTION,
  DEFAULT_MERGE_THRESHOLD,
  type BookStats,
  type ChunkingOptions,
} from '../../shared/types';

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
  /** Set during ingest before long-chapter sectioning; stripped from returned chunks. */
  sourceEntryStart?: number;
  sourceEntryEnd?: number;
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
  /^(?=.*\p{L})[\p{Lu}\p{N}\p{Z}\p{P}]{1,200}$/u, // ALL-CAPS line (no lowercase, at least one letter)
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

interface ParaEntry {
  text: string;
  chapterNumber: number | null;
  chapterTitle: string | null;
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
 * oversized paragraphs split on sentence boundaries; optional merge pass combines
 * tiny pieces within a chapter; optional long-chapter sectioning uses source paragraph
 * counts after merge (including preamble when the run exceeds the limit).
 */
export function chunkText(text: string, options?: ChunkingOptions): RawChunk[] {
  const chapterPatterns: RegExp[] =
    options?.chapterPatterns !== undefined
      ? compilePatterns(options.chapterPatterns, 'iu')
      : DEFAULT_CHAPTER_PATTERNS;

  const sectionSeparators: RegExp[] = compilePatterns(options?.sectionSeparators ?? []);
  const excludePatterns: RegExp[] = compilePatterns(options?.excludePatterns ?? [], 'i');
  const minTokens = options?.minTokens ?? MIN_TOKENS;
  const maxTokens = options?.maxTokens ?? MAX_TOKENS;

  // ── 1. Paragraph separation ───────────────────────────────────────────────
  // Split by blank lines and section separators only — no chapter detection yet.
  const rawParagraphs: string[] = [];
  let current: string[] = [];
  for (const line of text.split('\n')) {
    const isBreak =
      line.trim() === '' ||
      (sectionSeparators.length > 0 && sectionSeparators.some((p) => p.test(line.trim())));
    if (isBreak) {
      if (current.length > 0) { rawParagraphs.push(current.join('\n').trim()); current = []; }
    } else {
      current.push(line);
    }
  }
  if (current.length > 0) rawParagraphs.push(current.join('\n').trim());

  // ── 2. Exclude paragraphs ─────────────────────────────────────────────────
  const keptParagraphs = excludePatterns.length > 0
    ? rawParagraphs.filter((p) => !excludePatterns.some((re) => re.test(p)))
    : rawParagraphs;

  // ── 3. Chapter detection ──────────────────────────────────────────────────
  // Walk line-by-line within each kept paragraph so headers not surrounded by
  // blank lines are still detected (common in plain-text books).
  const entries: ParaEntry[] = [];
  let chapterCount = 0;
  let currentChapter: string | null = null;

  for (const para of keptParagraphs) {
    let buf: string[] = [];
    for (const line of para.split('\n')) {
      const chapterName = detectChapter(line.trim(), chapterPatterns);
      if (chapterName) {
        if (buf.length > 0) {
          const t = buf.join('\n').trim();
          if (t) entries.push({ text: t, chapterNumber: chapterCount || null, chapterTitle: currentChapter });
          buf = [];
        }
        chapterCount++;
        currentChapter = chapterName;
      } else {
        buf.push(line);
      }
    }
    if (buf.length > 0) {
      const t = buf.join('\n').trim();
      if (t) entries.push({ text: t, chapterNumber: chapterCount || null, chapterTitle: currentChapter });
    }
  }

  const maxParasRaw = options?.maxParagraphsPerChapterSection;
  const maxParas =
    maxParasRaw === 0
      ? 0
      : (maxParasRaw ?? DEFAULT_MAX_PARAGRAPHS_PER_CHAPTER_SECTION);
  const trackSources = maxParas > 0;

  // ── 4. Build chunks (enforce token size limits) ───────────────────────────
  const chunks: RawChunk[] = [];
  const indexRef = { i: 0 };
  for (let ei = 0; ei < entries.length; ei++) {
    const { text: para, chapterNumber, chapterTitle } = entries[ei]!;
    pushTokenChunksForParagraph(
      para,
      chapterNumber,
      chapterTitle,
      minTokens,
      maxTokens,
      chunks,
      indexRef,
      trackSources ? ei : undefined,
    );
  }

  // ── 5. Merge small chunks within the same section (including preamble) ──────
  const mergeThreshold = options?.mergeThreshold ?? DEFAULT_MERGE_THRESHOLD;
  let merged = mergeThreshold > 0 ? mergeSmallChunks(chunks, mergeThreshold) : chunks;

  // ── 6. Long chapters: assign sections from source paragraphs (after merge) ─
  if (maxParas > 0 && entries.length > 0) {
    merged = applyLongChapterSectionsAfterMerge(entries, merged, maxParas, minTokens, maxTokens);
  }

  return stripChunkSourceFields(merged);
}

function pushTokenChunksForParagraph(
  para: string,
  chapterNumber: number | null,
  chapterTitle: string | null,
  minTokens: number,
  maxTokens: number,
  out: RawChunk[],
  indexRef: { i: number },
  sourceEI?: number,
): void {
  if (!para) return;
  const tokens = countTokens(para);
  if (tokens < minTokens) return;

  const push = (rawText: string, tokenCount: number) => {
    const row: RawChunk = {
      chapterNumber,
      chapterTitle,
      paragraphIndex: indexRef.i++,
      rawText,
      tokenCount,
    };
    if (sourceEI !== undefined) {
      row.sourceEntryStart = sourceEI;
      row.sourceEntryEnd = sourceEI;
    }
    out.push(row);
  };

  if (tokens > maxTokens) {
    const sentences = para.match(/[^.!?]+[.!?]+/g) ?? [para];
    let buf = '';
    for (const s of sentences) {
      if (countTokens(buf + s) > maxTokens && buf) {
        const t = buf.trim();
        push(t, countTokens(t));
        buf = s;
      } else {
        buf += s;
      }
    }
    if (buf.trim() && countTokens(buf.trim()) >= minTokens) {
      const t = buf.trim();
      push(t, countTokens(t));
    }
  } else {
    push(para, tokens);
  }
}

/** Maps each source paragraph index to a section id and title. Runs longer than maxParas are subdivided (including preamble). */
function buildEntrySectionAssignments(
  entries: ParaEntry[],
  maxParas: number,
): Array<{ sectionId: number; chapterTitle: string | null }> {
  const meta: Array<{ sectionId: number; chapterTitle: string | null }> = new Array(entries.length);
  let nextSectionId = 1;
  let i = 0;
  while (i < entries.length) {
    const cn = entries[i]!.chapterNumber;
    let j = i + 1;
    while (j < entries.length && entries[j]!.chapterNumber === cn) j++;
    const title = entries[i]!.chapterTitle;
    const runLen = j - i;
    const mustSubdivide = runLen > maxParas;

    if (!mustSubdivide) {
      const sid = nextSectionId++;
      for (let k = i; k < j; k++) meta[k] = { sectionId: sid, chapterTitle: title };
    } else {
      for (let b = i; b < j; b += maxParas) {
        const be = Math.min(b + maxParas, j);
        const sid = nextSectionId++;
        for (let k = b; k < be; k++) meta[k] = { sectionId: sid, chapterTitle: title };
      }
    }
    i = j;
  }
  return meta;
}

function applyLongChapterSectionsAfterMerge(
  entries: ParaEntry[],
  chunks: RawChunk[],
  maxParas: number,
  minTokens: number,
  maxTokens: number,
): RawChunk[] {
  const meta = buildEntrySectionAssignments(entries, maxParas);
  const out: RawChunk[] = [];
  const indexRef = { i: 0 };

  for (const c of chunks) {
    const es = c.sourceEntryStart;
    const ee = c.sourceEntryEnd;
    if (es === undefined || ee === undefined) {
      out.push({ ...c, paragraphIndex: indexRef.i++ });
      continue;
    }

    if (meta[es]!.sectionId === meta[ee]!.sectionId) {
      out.push({
        ...c,
        chapterNumber: meta[es]!.sectionId,
        chapterTitle: meta[es]!.chapterTitle,
        paragraphIndex: indexRef.i++,
      });
      continue;
    }

    let g0 = es;
    let curSid = meta[es]!.sectionId;
    for (let k = es + 1; k <= ee; k++) {
      if (meta[k]!.sectionId !== curSid) {
        const text = entries
          .slice(g0, k)
          .map((e) => e.text)
          .join('\n\n');
        pushTokenChunksForParagraph(
          text,
          meta[g0]!.sectionId,
          meta[g0]!.chapterTitle,
          minTokens,
          maxTokens,
          out,
          indexRef,
          undefined,
        );
        g0 = k;
        curSid = meta[k]!.sectionId;
      }
    }
    const text = entries
      .slice(g0, ee + 1)
      .map((e) => e.text)
      .join('\n\n');
    pushTokenChunksForParagraph(
      text,
      meta[g0]!.sectionId,
      meta[g0]!.chapterTitle,
      minTokens,
      maxTokens,
      out,
      indexRef,
      undefined,
    );
  }

  return out;
}

function stripChunkSourceFields(chunks: RawChunk[]): RawChunk[] {
  return chunks.map((c, i) => ({
    chapterNumber: c.chapterNumber,
    chapterTitle: c.chapterTitle,
    paragraphIndex: i,
    rawText: c.rawText,
    tokenCount: c.tokenCount,
  }));
}

function mergeSmallChunks(chunks: RawChunk[], threshold: number): RawChunk[] {
  const result: RawChunk[] = [];
  for (const chunk of chunks) {
    const lastIdx = result.length - 1;
    const last = lastIdx >= 0 ? result[lastIdx] : undefined;
    if (last && last.tokenCount < threshold && last.chapterNumber === chunk.chapterNumber) {
      const mergedRow: RawChunk = {
        chapterNumber: last.chapterNumber,
        chapterTitle: last.chapterTitle,
        paragraphIndex: last.paragraphIndex,
        rawText: last.rawText + '\n\n' + chunk.rawText,
        tokenCount: last.tokenCount + chunk.tokenCount,
      };
      if (last.sourceEntryStart !== undefined && chunk.sourceEntryEnd !== undefined) {
        mergedRow.sourceEntryStart = last.sourceEntryStart;
        mergedRow.sourceEntryEnd = chunk.sourceEntryEnd;
      }
      result[lastIdx] = mergedRow;
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
