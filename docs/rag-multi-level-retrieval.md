# RAPTOR-inspired multi-level retrieval

Standard RAG retrieves only from raw text chunks. A concept is sometimes described *indirectly* in one chapter — without using its canonical name — making it invisible to semantic search on that name. Classic example: a substance described as "a crystalline residue on the workbench" in Chapter 1, only named "the Binding Catalyst" from Chapter 3 onward. A chunk search for "Binding Catalyst" will miss Chapter 1 entirely.

**RAPTOR** (Recursive Abstractive Processing for Tree-Organized Retrieval) solves this by indexing all levels of the abstraction tree alongside the raw chunks. A query can then retrieve from whichever level best matches its scope.

TomeDome's implementation:

- After abstract generation completes, `chapter_detailed`, `chapter_short`, and `book` abstracts are **embedded and stored** in an `abstract_embeddings` table alongside `chunk_embeddings`
- At query time, `buildRagContext` runs a **parallel abstract search** and appends novel results (chapters not already covered by chunk retrieval) under a `## Relevant chapter summaries` section in the context block
- Deduplication is applied per `(bookId, chapterNumber)` — at most one abstract hit per chapter reaches the model
- Only `chapter_detailed` abstracts are searched by default (highest information density; `chapter_short` is already injected as orientation for chapters that appear in chunk hits)

**Why this works for the indirect-description problem:**  
The `chapter_detailed` abstract for Chapter 1 is generated from all raw text in that chapter. It summarises the workbench residue in its narrative context — mentioning that Aldric found a crystalline, water-soluble deposit. When the model later learns the substance is the Binding Catalyst, a query about it will retrieve the Chapter 1 detailed abstract via semantic similarity, surfacing the physical description that raw chunk search would have missed.

**Difference from full RAPTOR:**  
Full RAPTOR builds a multi-layer tree with recursive clustering across semantic boundaries, not chapter boundaries. TomeDome's approach is chapter-scoped (abstracts align to chapters, not semantic clusters) and tool-gated at higher levels (`read_chapter_detailed`, `read_book_abstract`). This is intentional — chapter structure is a meaningful and reader-legible boundary for a reading companion, unlike arbitrary semantic clusters.
