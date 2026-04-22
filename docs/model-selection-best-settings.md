# Model selection and best settings

This document explains how to choose chat, embedding, and reranker models for TomeDome today.

## 1) Base chat model: always a trade-off

There is no universally "best" model. You are balancing:

- capability on complex tasks (reasoning, structure, instruction following),
- price,
- latency.

Higher-tier models are usually better at difficult literary analysis and strict formatting constraints. Lower-tier models are cheaper but can fail basic instruction fidelity (for example: asked for 2-5 sentences, returning 0, 1, or 12).

## 2) Which benchmarks matter for our use case

Because we do literary analysis and long-context synthesis, these benchmark signals matter most:

- **AA-LCR (Long Context Reasoning)**: ability to reason over large context.
- **Humanity's Last Exam**: includes expert-level literature/humanities style tasks.
- **IFBench**: instruction-following reliability under constraints.
- **AA-Omniscience**: useful for hallucination-risk control.

Most other general benchmarks are less directly relevant to literature workflows.

Use public benchmark dashboards as directional input, not absolute truth:

- [Artificial Analysis model comparison](https://artificialanalysis.ai/models)

## 3) Embedding model selection

For embeddings, provider availability matters as much as leaderboard position.

- Public leaderboards can be noisy for production selection because many top entries are fine-tuned/custom or not available in common providers.
- MTEB is useful but crowded for practical provider-constrained choices.
- Agentset embedding leaderboard uses ELO and practical metrics; still domain-specific.

References:

- [MTEB leaderboard](https://huggingface.co/spaces/mteb/leaderboard)
- [Agentset embeddings leaderboard](https://agentset.ai/embeddings)

Why ELO can still help: it captures how often a model wins in direct head-to-head relevance comparisons, which is often more representative than one isolated metric.

Note on local deployment: local embedding models can work very well in this project. `Qwen3 Embedding 8B` is also a good local choice and usually does not require a huge machine.

## 4) Chunking and section sizing (critical)

Embedding quality and abstract quality are strongly dependent on chunk/section design. In practice, chunking is one of the most important RAG quality levers.

Recommended defaults for literature and long-form prose:

- chunk size: **300-600 tokens**,
- overlap: **~10-15%**,
- prefer paragraph/section-aware splitting over blind fixed splits.

Why:

- shorter chunks improve pinpoint retrieval, but can lose narrative context,
- larger chunks preserve context, but can dilute retrieval precision,
- for technical/manual-style RAG, shorter chunks are often better than for literary analysis.

Section/chapter sizing for abstract generation:

- avoid very long chapters/sections,
- avoid too few sections per book (detail gets dropped by abstract caps),
- practical target: **10-70 sections per book** (depends on book length/style).

Context budgeting for chapter abstracts:

- keep abstract-generation input under about **50% of model context window** as a safety target,
- reserve the rest for system instructions, prompt framing, and output space.

Evidence status:

- there is no strong literature-specific public benchmark standard for this yet,
- these values are practical defaults from current RAG chunking guidance and context-management practice.

References:

- [Document chunking: precision vs context trade-off](https://mbrenndoerfer.com/writing/document-chunking-rag-strategies-retrieval)
- [Chunking strategy guide (practical defaults)](https://machinelearningplus.com/gen-ai/optimizing-rag-chunk-size-your-definitive-guide-to-better-retrieval-accuracy/)
- [Context budgeting guideline (leave headroom)](https://fieldguidetoai.com/guides/context-management)

## 5) Current chunking/embedding/abstract pipeline in TomeDome

### 5.1 Chunking strategy used by the app

Ingest flow (plain text/EPUB) is paragraph-first, then token-size enforcement:

- paragraph split by blank lines plus optional `sectionSeparators`,
- optional paragraph exclusion via `excludePatterns`,
- chapter detection by line regex (`chapterPatterns`, with built-in markdown heading/all-caps handling),
- token estimate uses a lightweight `~4 chars = 1 token` heuristic.

Pro tip for chapter recognition in multilingual books:

- Polish-safe baseline (strict chapter prefix): `^Rozdział [\p{Lu}\p{N}\p{Z}\p{P}]{1,200}`
- More universal Polish variant (alternative chapter words): `^(?:Rozdział|Księga|Część) [\p{Lu}\p{N}\p{Z}\p{P}]{1,200}`
- You can replace the alternation group with equivalent chapter words in any language (for example: `Chapter|Part|Book`) while keeping the same suffix pattern.

Current defaults in code:

- `minTokens = 3`,
- `maxTokens = 600` (paragraphs above this are split on sentence boundaries),
- `mergeThreshold = 300` (small neighbor merge inside same chapter/section),
- `maxParagraphsPerChapterSection = 300` (long chapter runs are subdivided into numbered sections after merge).

Important implementation note: current chunking has no explicit overlap window. Coherence is preserved primarily through paragraph/section boundaries plus merge of tiny chunks.

You can adjust this per import via `chunkingOptions`, and also manually:

- exclude selected preview chunks (`excludedChunkIndices`),
- override detected chapter/section titles (`chapterTitleOverrides`).

Chunking recommendation references used here:

- [Document chunking: precision vs context trade-off](https://mbrenndoerfer.com/writing/document-chunking-rag-strategies-retrieval)
- [Chunking strategy guide (practical defaults)](https://machinelearningplus.com/gen-ai/optimizing-rag-chunk-size-your-definitive-guide-to-better-retrieval-accuracy/)

### 5.2 How embeddings are calculated in the app

Embedding generation is batched and provider-adapter based:

- batch size is `20`,
- text input is raw chunk text (`chunks.raw_text`) for chunk embeddings,
- model is `embeddingModel` from config,
- vectors are stored as JSON with `model` and `dim`.

Abstract embeddings are also generated (same embedding model) for levels:

- `chapter_detailed`,
- `chapter_short`,
- `book`.

Retrieval scoring uses cosine similarity at query time over stored vectors.

### 5.3 How paragraphs/chunks are grouped for abstract generation prompts

Abstract generation groups by `chapter_number` (section key):

1. all chunk texts in a section are concatenated with `\n\n` to build `sectionText`,
2. `sectionText` is sent to the detailed abstract prompt,
3. resulting detailed abstract is sent to the short abstract prompt,
4. all short abstracts are concatenated with `\n\n` for book-level abstract prompt.

Default token caps for outputs:

- detailed: `4000`,
- short: `2000`,
- book: `1500`.

So practical abstract quality depends directly on chunk/section sizing before this step.

## 6) Current recommended default (as of 2026-04-22)

Given current price/capability trade-offs and multilingual needs:

- **Chat model**: `Gemini 3 Flash Preview`
- **Embedding model**: `Qwen3 Embedding 8B`

Reasoning:

- very low cost,
- large context windows,
- good practical behavior for multilingual text.

Treat this as a current default, not a permanent rule.

## 7) Reranker guidance

Reranker availability is limited across providers.

Recommended default: use the most popular reranker your provider offers. In most cases, it should do the job.

If you need stricter selection later, optimize for:

- stability in your pipeline,
- acceptable latency/cost for your workload.

Reference:

- [Agentset reranker benchmark](https://agentset.ai/blog/best-reranker)

At this stage, we do not have a strong in-house reranker benchmark yet, so we rely on external benchmarks.

## 8) Local model caveat

Current local options (e.g. `Gemma 4 31B`, `Qwen 3.5 9B`, `Gemma 4 E4B`) are not first-choice for abstract generation quality/stability.

Observed behavior:

- sometimes useful output,
- inconsistent validity/format compliance,
- can make the app appear buggy or error-prone if used as the only option.

Recommendation: keep local models as fallback/experimentation path, not default production path for abstract generation.

## 9) Next step: internal benchmark

Long-term, selection should be driven by our own regression benchmark on synthetic corpus and task rubric:

- [`docs/synthetic-book-evaluation.md`](./synthetic-book-evaluation.md)

Until then, use external benchmarks plus provider constraints as practical guidance.
