import { readFileSync, statSync } from 'node:fs';
import { basename } from 'node:path';
import safeRegex from 'safe-regex2';
import { Book } from '@likecoin/epub-ts/node';
import * as cheerio from 'cheerio';
import type { Element } from 'domhandler';
import type { EpubOptions } from '../../shared/types';
import { DEFAULT_EPUB_OPTIONS } from '../../shared/types';

type TocEntry = { href: string; label: string; subitems?: TocEntry[] };

function flattenToc(items: TocEntry[]): TocEntry[] {
  const out: TocEntry[] = [];
  const walk = (list: TocEntry[]) => {
    for (const it of list) {
      out.push(it);
      if (it.subitems?.length) walk(it.subitems);
    }
  };
  walk(items);
  return out;
}

function stripHash(href: string): string {
  const hashIndex = href.indexOf('#');
  return hashIndex === -1 ? href : href.slice(0, hashIndex);
}

function isBoilerplateDocumentTitle(title: string): boolean {
  const normalizedText = title.replace(/\s+/g, ' ').trim();
  if (!normalizedText) return true;
  if (/\bproject gutenberg\b/i.test(normalizedText)) return true;
  if (/\|\s*project gutenberg\s*$/i.test(normalizedText)) return true;
  return false;
}

function extractSectionHeading(html: string): string | null {
  const $ = cheerio.load(html);
  const headTitle = $('head > title').first().text().replace(/\s+/g, ' ').trim();
  if (headTitle && !isBoilerplateDocumentTitle(headTitle)) return headTitle;
  for (const sel of ['h1', 'h2', 'h3']) {
    const extractedText = $('body').find(sel).first().text().replace(/\s+/g, ' ').trim();
    if (extractedText && extractedText.length < 500) return extractedText;
  }
  return null;
}

function stripAndToText(
  $: cheerio.CheerioAPI,
  root: cheerio.Cheerio<Element>,
  boilerplateSelector: string,
): string {
  root.find('hgroup').remove();
  root.find(boilerplateSelector).remove();
  root.find('h1,h2,h3').remove();
  const lines: string[] = [];
  root.find('p, li').each((_, el) => {
    const $el = $(el);
    if ($el.parents('aside,figure,header,footer,nav').length) return;
    const raw = $el.text().replace(/\s+/g, ' ').trim();
    if (raw) lines.push(raw);
  });
  if (lines.length) return lines.join('\n\n');
  return root.text().replace(/\s+/g, ' ').trim();
}

function compilePatterns(patterns: string[], flags = 'iu'): RegExp[] {
  return patterns.flatMap((p) => {
    if (!safeRegex(p)) return [];
    try {
      return [new RegExp(p, flags)];
    } catch {
      return [];
    }
  });
}

function shouldIncludeChapter(label: string, skipRes: RegExp[], includeRes: RegExp[]): boolean {
  const trimmedLabel = label.trim();
  if (!trimmedLabel) return false;
  if (skipRes.some((re) => re.test(trimmedLabel))) return false;
  return includeRes.some((re) => re.test(trimmedLabel));
}

export async function parseEpub(filePath: string, options?: EpubOptions): Promise<string> {
  const opts = {
    boilerplateSelectors:
      options?.boilerplateSelectors ?? DEFAULT_EPUB_OPTIONS.boilerplateSelectors,
    skipLabelPatterns: options?.skipLabelPatterns ?? DEFAULT_EPUB_OPTIONS.skipLabelPatterns,
    includeLabelPatterns:
      options?.includeLabelPatterns ?? DEFAULT_EPUB_OPTIONS.includeLabelPatterns,
  };

  const boilerplateSelector = opts.boilerplateSelectors.join(', ');
  const skipRes = compilePatterns(opts.skipLabelPatterns);
  const includeRes = compilePatterns(opts.includeLabelPatterns);

  const MAX_EPUB_BYTES = 100 * 1024 * 1024;
  const fileStats = statSync(filePath);
  if (fileStats.size > MAX_EPUB_BYTES) {
    throw new Error(`EPUB exceeds ${MAX_EPUB_BYTES / (1024 * 1024)} MB limit`);
  }

  const buf = readFileSync(filePath);
  const arrayBuffer = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const book = new Book(arrayBuffer) as any;
  await book.opened;

  const req = book.archive.request.bind(book.archive);
  const flat = flattenToc(book.navigation.toc as TocEntry[]);
  const chapters = flat.filter((it) => shouldIncludeChapter(it.label, skipRes, includeRes));

  const seenHref = new Set<string>();
  const parts: string[] = [];
  const bookTitle = book.packaging?.metadata?.title as string | undefined;
  if (bookTitle) {
    parts.push(`# ${bookTitle}`, '');
  }

  for (const ch of chapters) {
    const base = stripHash(ch.href);
    if (seenHref.has(base)) continue;
    seenHref.add(base);
    const section = book.spine.get(base);
    if (!section) continue;
    const html = (await section.render(req)) as string;
    const $ = cheerio.load(html);
    const body = $('body');
    if (!body.length) continue;
    const heading = ch.label.trim().replace(/\s+/g, ' ');
    parts.push(`## ${heading}`, '');
    parts.push(stripAndToText($, body, boilerplateSelector));
    parts.push('');
  }

  if (chapters.length === 0) {
    const spineLength = book.spine.length as number;
    for (let i = 0; i < spineLength; i++) {
      const section = book.spine.get(i);
      if (!section?.href) continue;
      if (seenHref.has(section.href as string)) continue;
      seenHref.add(section.href as string);
      const html = (await section.render(req)) as string;
      const $ = cheerio.load(html);
      const body = $('body');
      if (!body.length) continue;
      const heading = extractSectionHeading(html) ?? (basename(section.href as string));
      parts.push(`## ${heading}`, '');
      parts.push(stripAndToText($, body, boilerplateSelector));
      parts.push('');
    }
  }

  return parts.join('\n').trim() + '\n';
}
