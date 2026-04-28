# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.1.9] - 2026-04-28
### Fixed
- **"Use model default" not persisting** for temperature, top-p, and top-k: AJV was coercing `null → 0` when validating `anyOf: [number, null]` body schemas, causing the save to write `0` to the DB instead of deleting the key; parameters now correctly clear and are omitted from API requests.

### Changed
- **OpenAI-compatible adapter**: GPT and o-series models now send `max_completion_tokens` instead of `max_tokens`, which is required by the OpenAI API for these model families.
- **Reasoning model UX** (o1/o3/o4 on OpenAI and OpenRouter): removed silent suppression of sampling parameters in the adapter; Settings now shows a warning when a potential reasoning model is detected and automatically resets temperature/top-p to model defaults on model selection — custom values can still be set but the user is informed of the risk.

## [0.1.8] - 2026-04-27
### Added
- **Semantic search tool** (`search_semantic`): the model can trigger an embedding search with a self-formulated query, solving follow-up questions where the user's literal message embeds poorly. Complements `search_text` (verbatim keyword hits) with conceptual/descriptive retrieval. Returns `null` gracefully when no embedding model is configured.
- **Tool call logging**: each tool execution in the agentic loop is now recorded as its own `llm_calls` row with purpose `tool_call`, the tool name as model, full arguments in `requestJson`, the tool output in `responseText`, and execution latency.
- **Chunk context expansion** (`read_chunk_window` tool): when a retrieved passage cuts off mid-scene or mid-dialogue, the model can fetch N chunks before and after it using the `[chunk: id]` annotation now included in every RAG passage header.
- **Keyword search tool** (`search_text`): the model can run a direct FTS5 keyword search over all ingested text, with optional per-book scoping. Useful for locating every occurrence of a name or phrase that semantic retrieval may rank lower.
- **Chapter list tool** (`list_chapters`): lightweight chapter index (number → title) used to resolve ambiguous chapter references before calling abstract tools. Consecutive chapters sharing the same title are annotated as split parts (e.g. `(part 1 of 2)`) so the model knows to retrieve all parts.
- System prompt: **Chapter reference disambiguation** rule — instructs the model to call `list_chapters` before any chapter abstract tool when the user's reference is not an unambiguous integer, and to retrieve all annotated split parts.
- **Ollama tool calling**: `OllamaAdapter` now implements `call()`, enabling the full agentic tool-use loop for Ollama models (Qwen3, Llama3, etc.). Handles Ollama wire-format differences (arguments as objects, no tool call IDs, think-block stripping from response content).

### Changed
- System prompt: `search_text` and `search_semantic` descriptions rewritten with a mechanical decision rule — *exact known words → `search_text`; concept or description → `search_semantic`* — to minimise wrong-tool selection.
- System prompt: pre-retrieved passages clarified as **verbatim raw text** (not generated summaries); added explicit guidance to use `search_semantic` for follow-up quote requests when the current RAG context has shifted.

## [0.1.7] - 2026-04-27
### Added
- **Temperature control**: per-provider temperature setting in Settings. Slider (0–1 for Anthropic/LM Studio, 0–2 for OpenAI/OpenRouter/Ollama) with a text input for exact values; "Use model default" checkbox omits the parameter from requests entirely. LM Studio falls back to character-based token estimation when the server does not return usage counts.
- Token counts for structured JSON generation calls (OpenAI-compatible providers and Ollama) now appear in LLM call logs.
- **Sampling parameters**: top_p (nucleus sampling, 0–1) and top_k (top-token filter, integer >= 0) per-provider controls in Settings, following the same "Use model default" pattern as temperature. top_k is hidden for OpenAI (unsupported), Anthropic shows a warning when both temperature and top_p are customized, and top_p/top_k are logged in LLM call request payloads.

## [0.1.6] - 2026-04-25
### Changed
- **Observability (Stats / logs)**: LLM Calls and App Log share the same filter UI (multi-select, mark/unmark all, close on outside click); filters default to “all” when opening those tabs; no selection shows no rows; table headers match the token stats styling; Prompt/Output columns carry a small `[tokens]` label. App log API accepts optional comma-separated `levels` for exact severity filtering. LLM adapter logging covers more provider paths (embed, rerank, list/load model, non-chat calls). Clearing logs now archives LLM token/latency aggregates so stats persist after log purge; “Reset all data” clears that archive too.

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
### Changed
- App version is now read dynamically from `package.json` instead of being hardcoded in `export-service.ts` and `AboutPage.tsx`

### Fixed
- Windows build: replaced macOS-only `find`/`codesign` postinstall command with a cross-platform Node script

## 0.1.0 - 2026-04-19
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

[Unreleased]: https://github.com/pulina/tomedome/compare/v0.1.9...HEAD
[0.1.9]: https://github.com/pulina/tomedome/compare/v0.1.8...v0.1.9
[0.1.8]: https://github.com/pulina/tomedome/compare/v0.1.7...v0.1.8
[0.1.7]: https://github.com/pulina/tomedome/compare/v0.1.6...v0.1.7
[0.1.6]: https://github.com/pulina/tomedome/compare/v0.1.5...v0.1.6
[0.1.5]: https://github.com/pulina/tomedome/compare/v0.1.4...v0.1.5
[0.1.4]: https://github.com/pulina/tomedome/compare/v0.1.3...v0.1.4
[0.1.3]: https://github.com/pulina/tomedome/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/pulina/tomedome/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/pulina/tomedome/compare/v0.1.0...v0.1.1
