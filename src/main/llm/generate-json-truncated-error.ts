/** Thrown when structured JSON generation stops at max_tokens; carries provider partial body for logs. */
export class GenerateJsonTruncatedError extends Error {
  readonly partialContent: string | null;

  constructor(maxTokens: number, partialContent: string | null) {
    const chars = partialContent?.length ?? 0;
    const words = partialContent?.trim() ? partialContent.trim().split(/\s+/).length : 0;
    super(
      `generateJson truncated: model hit max_tokens (${maxTokens}) — increase maxTokens or reduce input ` +
        `(partial output: ${chars} chars, ~${words} words; inspect response body in LLM log)`,
    );
    this.name = 'GenerateJsonTruncatedError';
    this.partialContent = partialContent;
  }
}
