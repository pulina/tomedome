import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { configApi } from '../api/config-api';

const REQUEST_TIMEOUT_MS = 12_000;
const MAX_ATTEMPTS = 8;
const INITIAL_BACKOFF_MS = 350;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`LLM status request timed out after ${ms}ms`)), ms);
    promise.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

interface LlmStatusContextValue {
  configured: boolean | null;
  error: string | null;
  refresh: () => Promise<void>;
}

export const LlmStatusContext = createContext<LlmStatusContextValue | null>(null);

export function useLlmStatusContextValue(): LlmStatusContextValue {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef(0);

  const refresh = useCallback(async () => {
    attemptRef.current += 1;
    const myAttempt = attemptRef.current;
    setError(null);

    let lastMessage = 'Unknown error';

    for (let i = 0; i < MAX_ATTEMPTS; i++) {
      if (myAttempt !== attemptRef.current) return;

      try {
        const s = await withTimeout(configApi.getLlmStatus(), REQUEST_TIMEOUT_MS);
        if (myAttempt !== attemptRef.current) return;
        setConfigured(s.configured);
        setError(null);
        return;
      } catch (err) {
        lastMessage = err instanceof Error ? err.message : String(err);
        if (i < MAX_ATTEMPTS - 1) {
          const backoff = Math.min(INITIAL_BACKOFF_MS * 2 ** i, 6000);
          await sleep(backoff);
        }
      }
    }

    if (myAttempt !== attemptRef.current) return;
    setError(lastMessage);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { configured, error, refresh };
}

export function useLlmStatus(): LlmStatusContextValue {
  const ctx = useContext(LlmStatusContext);
  if (!ctx) throw new Error('useLlmStatus must be used inside LlmStatusContext.Provider');
  return ctx;
}
