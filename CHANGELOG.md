# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/pulina/tomedome/compare/v0.1.2...HEAD
[0.1.2]: https://github.com/pulina/tomedome/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pulina/tomedome/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/pulina/tomedome/releases/tag/v0.1.0
