/**
 * Low-level transport helpers shared by adapters.
 */

export async function safeText(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 300);
  } catch {
    return '';
  }
}

/** Reads a ReadableStream as text, calling onChunk for each decoded piece. */
export async function readStream(
  body: ReadableStream<Uint8Array>,
  onChunk: (s: string) => void,
  signal?: AbortSignal,
): Promise<void> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  try {
    while (true) {
      if (signal?.aborted) throw new Error('aborted');
      const { done, value } = await reader.read();
      if (done) break;
      onChunk(decoder.decode(value, { stream: true }));
    }
    onChunk(decoder.decode());
  } finally {
    try {
      reader.releaseLock();
    } catch {
      // ignore
    }
  }
}

/** Parses a Server-Sent Events stream, buffering across chunk boundaries. */
export class SseParser {
  private buf = '';

  push(chunk: string, onEvent: (event: { event: string | null; data: string }) => void): void {
    this.buf += chunk;
    let idx: number;
    while ((idx = this.buf.indexOf('\n\n')) !== -1) {
      const raw = this.buf.slice(0, idx);
      this.buf = this.buf.slice(idx + 2);
      let event: string | null = null;
      const dataLines: string[] = [];
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
      }
      if (dataLines.length) onEvent({ event, data: dataLines.join('\n') });
    }
  }
}
