import net from 'node:net';
import { LlmProvider, TestConnectionResult, DEFAULT_OLLAMA_URL } from '@shared/types';
import type { LlmConfig } from '@shared/types';
import { getLogger } from '../lib/logger';
import { getAdapter } from '../llm';
import { withUserAgent } from '../llm/user-agent';
import { safeText } from '../llm/wire';

const TIMEOUT_MS = 15_000;
const PROBE_TIMEOUT_MS = 10_000;
const TCP_PROBE_MS = 5_000;

export type LocalBaseKind = 'ollama' | 'lmstudio';

export function normalizeHttpBaseUrl(
  url: string,
): { ok: true; base: string } | { ok: false; error: string } {
  const t = url.trim();
  if (!t) return { ok: false, error: 'URL is empty' };
  let parsed: URL;
  try {
    parsed = new URL(t);
  } catch {
    return { ok: false, error: 'Invalid URL' };
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { ok: false, error: 'Use http:// or https://' };
  }
  return { ok: true, base: t.replace(/\/$/, '') };
}

function jsonBodyLooksLikeOllamaTags(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  return Array.isArray((body as { models?: unknown }).models);
}

function jsonBodyLooksLikeOpenAiModelsList(body: unknown): boolean {
  if (body === null || typeof body !== 'object') return false;
  return Array.isArray((body as { data?: unknown }).data);
}

function hostPortFromHttpBase(base: string): { host: string; port: number } | null {
  try {
    const u = new URL(base);
    const portNum =
      u.port !== '' ? Number(u.port) : u.protocol === 'https:' ? 443 : 80;
    if (!Number.isFinite(portNum) || portNum <= 0 || portNum > 65535) return null;
    return { host: u.hostname, port: portNum };
  } catch {
    return null;
  }
}

/** Same idea as curl: if nothing accepts TCP on host:port, fail before HTTP (avoids odd fetch behaviour). */
function tcpReachable(host: string, port: number, ms: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port, noDelay: true });
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, ms);

    const finish = (ok: boolean) => {
      clearTimeout(timer);
      socket.removeAllListeners();
      try {
        socket.destroy();
      } catch {
        /* ignore */
      }
      resolve(ok);
    };

    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });
}

/** Lightweight reachability check for Ollama / LM Studio base URLs (used before listing models). */
export async function probeLocalLlmBaseUrl(
  kind: LocalBaseKind,
  url: string,
): Promise<{ ok: boolean; error?: string }> {
  const n = normalizeHttpBaseUrl(url);
  if (!n.ok) return { ok: false, error: n.error };

  const hp = hostPortFromHttpBase(n.base);
  if (!hp) return { ok: false, error: 'Invalid URL' };
  const tcpOk = await tcpReachable(hp.host, hp.port, TCP_PROBE_MS);
  if (!tcpOk) {
    return {
      ok: false,
      error: 'Nothing is accepting connections at that address (server off, wrong port, or firewall)',
    };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    if (kind === 'ollama') {
      const res = await fetch(`${n.base}/api/tags`, {
        signal: controller.signal,
        headers: withUserAgent({}),
        cache: 'no-store',
      });
      if (!res.ok) {
        return { ok: false, error: `HTTP ${res.status}: ${(await safeText(res)).slice(0, 160)}` };
      }
      const text = await res.text();
      let parsed: unknown;
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        return { ok: false, error: 'Not Ollama: /api/tags did not return JSON' };
      }
      if (!jsonBodyLooksLikeOllamaTags(parsed)) {
        return { ok: false, error: 'Not Ollama: expected { models: [...] } from /api/tags' };
      }
      return { ok: true };
    }
    const res = await fetch(`${n.base}/v1/models`, {
      method: 'GET',
      signal: controller.signal,
      headers: withUserAgent({}),
      cache: 'no-store',
    });
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}: ${(await safeText(res)).slice(0, 160)}` };
    }
    const text = await res.text();
    let parsed: unknown;
    try {
      parsed = JSON.parse(text) as unknown;
    } catch {
      return {
        ok: false,
        error: 'Not an OpenAI-compatible server: /v1/models did not return JSON',
      };
    }
    if (!jsonBodyLooksLikeOpenAiModelsList(parsed)) {
      return {
        ok: false,
        error: 'Not LM Studio / OpenAI API: expected { data: [...] } from /v1/models',
      };
    }
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === 'The operation was aborted.' || message.includes('abort')) {
      return { ok: false, error: 'Connection timed out' };
    }
    return { ok: false, error: message };
  } finally {
    clearTimeout(timer);
  }
}

export async function testLlmConnection(cfg: LlmConfig, apiKey: string): Promise<TestConnectionResult> {
  const log = getLogger().child({ module: 'llm-test', provider: cfg.provider });
  try {
    if (!cfg.provider) return { success: false, error: 'No provider configured' };

    if (cfg.provider === LlmProvider.Ollama) {
      const r = await probeLocalLlmBaseUrl('ollama', cfg.ollamaBaseUrl || DEFAULT_OLLAMA_URL);
      return r.ok ? { success: true } : { success: false, error: r.error ?? 'Unreachable' };
    }

    // All other providers: fire a minimal chat completion through the adapter.
    const adapter = getAdapter(cfg, apiKey);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      await adapter.stream({
        messages: [{ role: 'user', content: 'hi' }],
        model: cfg.model || 'default',
        maxTokens: 1,
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'connection test failed');
    return { success: false, error: message };
  }
}
