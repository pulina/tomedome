# Decision Log: Small-to-Big Retrieval Architecture

## Context
Current RAG implementation uses chunks of approximately 300 tokens for embedding and retrieval. Given our focus on fantasy literature, these chunks often contain critical narrative information that is highly dependent on surrounding prose (e.g., character descriptions, magical properties, or atmospheric shifts).

## The Proposal: "Small-to-Big" Expansion
Instead of using the retrieved chunk as the final context, we implement a windowed expansion:
1.  **Retrieve**: Identify the most relevant small chunk (the "anchor") via vector search.
2.  **Expand**: Fetch the anchor chunk plus its immediate neighbors (e.g., `[N-1] + [N] + [N+1]`).
3.  **Prompt**: Send the expanded window to the LLM.

## Analysis

### Pros
*   **Semantic Precision (DPR)**: Smaller anchors minimize "semantic dilution." In a 300-token chunk, a single subject might be obscured by unrelated text. A smaller, more focused chunk allows the embedding model to capture a more precise vector.
*   **Narrative Continuity**: Fantasy prose relies on context. An action in Chunk $N$ often depends on a setup in Chunk $N-1$. Expansion provides the "connective tissue" necessary for the LLM to understand character motivations and plot progression.
*   **Mitigation of "Lost in the Middle"**: By using high-quality small chunks for the *search* phase, we ensure the most relevant information is at the forefront of the retrieved set, even if the expanded window is larger.

### Cons
*   **Increased Latency**: Every user query now triggers additional database lookups or index fetches to retrieve adjacent chunks. This creates a linear increase in RAG pipeline latency.
*   **Token Inflation & Cost**: Expanding the context significantly increases the number of tokens processed per query. This leads to higher operational costs and potentially hits the context window limits of smaller models.
*   **Complexity in Boundary Handling**: Managing chunk indices, handling start/end of book boundaries, and preventing overlapping infinite expansions requires more complex retrieval logic.

### Optimization: Avoiding Unnecessary Expansion
To mitigate the latency and cost, we should implement a **Context Expansion Router**. The goal is to avoid expansion when the retrieved chunk is already "self-contained."

### Potential Strategies:
1.  **Metadata-Based Expansion (Heuristic)**:
    *   During indexing, flag chunks that contain "high-entropy" transitions (e.s., paragraph breaks or chapter ends).
    *   Only trigger expansion for chunks flagged as `is_boundary: true`.
2.  **Lightweight Evaluator (LLM/Classifier)**:
    *   Use a very small, fast model (e.g., a fine-tuned small BERT or a tiny LLM) to perform a "sufficiency check" on the retrieved chunk.
    *   **Input**: Anchor Chunk.
    *   **Output**: `Expand` or `Keep`.
3.  **Semantic Uncertainty Threshold**:
    *   Analyze the cosine similarity score of the retrieval. If the confidence is extremely high, assume the context is sufficient. If the score is mediocre, expand to find supporting evidence.

## Verdict & Next Steps
**Recommendation: Proceed with a controlled experiment.**

We should not implement this globally until we quantify the impact on **Context Recall** vs. **Latency**.

**Experimental Plan:**
1.  **Dataset**: Use a subset of processed fantasy books.
2.  **Metric 1 (RAGAS)**: Measure `Context Precision` and `Context Recall` for (a) Standard RAG vs (b) Small-to-Big RAG.
3.  **Metric 2 (Latency)**: Measure the $P95$ latency increase of the expansion step.
4.  **Success Criteria**: An increase in `Context Recall` of $>15\%$ that justifies a latency penalty of $<200$ms.
