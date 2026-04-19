/**
 * Strips <think>…</think> reasoning blocks from model output.
 * Handles both complete and unclosed blocks (model was cut off mid-think).
 */
export function stripThinkBlocks(s: string): string {
  // Remove complete blocks and unclosed opening tags.
  let out = s.replace(/<think>[\s\S]*?<\/think>/gi, '');
  out = out.replace(/<think>[\s\S]*/gi, '');
  // Models often emit a blank line or two after </think> before the real answer.
  return out.trim();
}

/**
 * Wraps an onToken callback and suppresses tokens inside <think>…</think>
 * reasoning blocks in real time. Handles tags split across multiple chunks.
 *
 * Usage:
 *   const filter = new ThinkFilter(emit);
 *   // for each incoming chunk:
 *   filter.push(chunk);
 *   // after stream ends:
 *   filter.flush();
 */
export class ThinkFilter {
  private buf = '';
  private inside = false;

  constructor(private readonly emit: (chunk: string) => void) {}

  push(chunk: string): void {
    this.buf += chunk;
    let out = '';

    while (this.buf.length > 0) {
      if (this.inside) {
        const end = this.buf.toLowerCase().indexOf('</think>');
        if (end === -1) {
          // Keep only enough tail to detect a split closing tag
          if (this.buf.length > 8) this.buf = this.buf.slice(this.buf.length - 8);
          break;
        }
        this.buf = this.buf.slice(end + 8); // consume through </think>
        this.inside = false;
      } else {
        const open = this.buf.toLowerCase().indexOf('<think>');
        if (open === -1) {
          // No opening tag — emit everything safe (keep last 7 chars as partial-tag guard)
          const safeEnd = Math.max(0, this.buf.length - 7);
          out += this.buf.slice(0, safeEnd);
          this.buf = this.buf.slice(safeEnd);
          break;
        }
        out += this.buf.slice(0, open);
        this.buf = this.buf.slice(open + 7); // consume through <think>
        this.inside = true;
      }
    }

    if (out) this.emit(out);
  }

  flush(): void {
    if (!this.inside && this.buf) this.emit(this.buf);
    this.buf = '';
  }
}
