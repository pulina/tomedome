# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.5] - 2026-04-23

### Added

- Optional asymmetric embedding instruct prefixes (query vs passage) for RAG, with passage prefix snapshotted per volume; supports instruct models such as E5, BGE, and Qwen embedding lines. Symmetric models should leave prefixes empty.
- Chained **embedding → full abstract regeneration** when chunk/profile settings no longer match stored vectors (`chainAbstractGeneration`); job list shows **Embeddings + abstracts** (tooltip explains the two phases).
- At most **one** pending or running abstract-or-embedding job per book; starting another returns **409** until the current job finishes or is cancelled.

### Changed

- **Ingest**: choosing both abstracts and embeddings runs **one** sequential pipeline on the server instead of two parallel jobs.
- **HTTP client**: error alerts use the API `message` body only (no `HTTP <status>:` prefix).
- **Chat** context API: `ragProfileMismatchCount` (was `ragModelMismatchCount`); RAG pill copy refers to embedding **profile** (model and/or passage prefix).

## [0.1.4] - 2026-04-22

### Added

- `docs/model-selection-best-settings.md`: guidance on chat/embedding/reranker choice, chunking defaults, and how ingest/abstracts use chunks; linked from README.

### Changed

- Abstracts modal: flex/`min-height` so the detailed tab scroll area lays out correctly; reset detailed pager when the book changes; auto-reveal more detailed items when the body is shorter than the viewport; cap “load more” at the total chapter count.

## [0.1.3] - 2026-04-21

### Added

- **Book import API**: optional `chapterTitleOverrides` so chapter labels edited in preview are applied when chunks are persisted.

### Changed

- **Chunking pipeline**: Unicode-aware chapter detection (incl. non-Latin “all-caps” lines); chapter headers can be found inside multi-line paragraphs; optional `excludePatterns` to drop paragraphs before chunking; merge pass then long-chapter sectioning using source-paragraph spans. Defaults for merge threshold and max paragraphs per section are **300** (`DEFAULT_MERGE_THRESHOLD`, `DEFAULT_MAX_PARAGRAPHS_PER_CHAPTER_SECTION`); omitting API fields uses those defaults; `maxParagraphsPerChapterSection: 0` disables sectioning.
- **Ingest preview / wizard**: Exclude specific chunks from import; per-chapter title overrides in the UI; clearer custom-regex editing (tag lists); expandable chunk bodies and layout tweaks; preview stats and cost hints reflect chunks that stay after exclusions.

## [0.1.2] - 2026-04-21

### Changed

- Chunking: default merge-small-chunks threshold is 100 tokens (was 0); small trailing chunks merge into the next chunk within the same chapter unless set to 0.
- Ingest wizard uses the same default for the merge-threshold control.

### Fixed

- Ingest wizard closing on misclick or focus loss (`type="button"` on actions; backdrop no longer closes the modal).

## [0.1.1] - 2026-04-19

### Fixed

- Windows build: replaced macOS-only `find`/`codesign` postinstall command with a cross-platform Node script

### Changed

- App version is now read dynamically from `package.json` instead of being hardcoded in `export-service.ts` and `AboutPage.tsx`

## [0.1.0] - 2026-04-19

### Added

- EPUB import and parsing with chapter/paragraph extraction
- Automatic text chunking and embedding generation for imported books
- Vector store (SQLite + better-sqlite3) for semantic search over book content
- RAG-based chat: ask questions about a book series with source-cited answers
- Series and library management — group books, track reading context
- AI-generated chapter abstracts for fast navigation
- LLM provider configuration (model, API key, endpoint)
- Export and import of processed book data (`.tomedome` archive format)
- Stats and logs page for monitoring ingestion jobs and LLM call history
- Cross-platform builds: macOS (arm64, x64), Windows (x64), Linux (deb, rpm)

[Unreleased]: https://github.com/pulina/tomedome/compare/v0.1.5...HEAD
[0.1.5]: https://github.com/pulina/tomedome/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/pulina/tomedome/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/pulina/tomedome/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/pulina/tomedome/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pulina/tomedome/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pulina/tomedome/releases/tag/v0.1.0
