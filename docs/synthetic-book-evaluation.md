# Synthetic book for RAG evaluation

Evaluating RAG on well-known books (e.g. Sherlock Holmes) is weak: the model may answer from **training memory** instead of retrieved chunks, so you cannot separate good retrieval from recall.

TomeDome keeps a **fully invented manuscript** in the repo so that correct answers must come from **your** pipeline, not from anything that could appear in pretraining.

## Manuscript in this repository

- **[`book_example/pl_book.md`](../book_example/pl_book.md)** — *Protokół Zdarzenia*, a Polish-language fantasy comedy in chapters, with invented proper nouns, locations, and bureaucratic plot. It is original content; safe to commit and use as a regression corpus.
- **[`book_example/the_incident_report_plan.md`](../book_example/the_incident_report_plan.md)** — the generation blueprint (characters, world rules, tone) used to produce that text. It documents design intent and constraints; the eval text itself is `pl_book.md`.

## What the text was built to exercise

The blueprint and the novel were written so that automated tests could stress:

- **Invented names and places** — not resolvable from general knowledge (e.g. inspektor Aldric Pembe, Grumblwick, Komisja ds. Magicznych Nieścisłości).
- **Precise, checkable plot detail** — events tied to chapters and forms so golden answers can cite “what the file says”.
- **Breadcrumbs and callbacks** — figures and threads that reappear across chapters.
- **Aliases and formal registers** — titles, Polish administrative wording, and recurring jargon (“nieprawidłowość”, category labels) for entity and retrieval behaviour.
- **Red herrings and tone** — comedy/bureaucratic misdirection where faithfulness scoring still matters.
- **Stable chapter boundaries** — headings and structure ingestion can rely on.

## How it was produced

A first draft was generated with an LLM from the blueprint; the manuscript was then **edited by hand** so breadcrumbs, consistency, and jokes land where intended. Any **golden Q/A set** for benchmarks should be written **from the final `pl_book.md` text**, not from memory of the plot.

## Why we still use LLM-as-judge

Model output is noisy; binary pass/fail is brittle; one LLM grading another adds variance. For benchmarks, use a **structured, multi-dimensional** rubric (faithfulness, completeness, entity accuracy, spoiler safety, relevance, etc.) on a clear scale, with median-of-runs where needed.

For **end-to-end model benchmarks** on this book: run the same golden Q/A set through embedding + retrieval + chat, score with the judge dimensions (and hit-rate@k when you only test retrieval), and store results per model run for regression comparison.

## Further reading

- [RAG Evaluation](https://huggingface.co/learn/cookbook/en/rag_evaluation) — Hugging Face cookbook: synthetic eval datasets and judging the full RAG loop.
- [Using LLM-as-a-judge](https://huggingface.co/learn/cookbook/en/llm_judge#using-llm-as-a-judge--for-an-automated-and-versatile-evaluation) — judge prompts, integer scales, and validating the judge against human ratings.
