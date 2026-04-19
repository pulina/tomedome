import { FormEvent, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { configApi } from '../../api/config-api';
import { dataApi } from '../../api/data-api';
import { useLlmStatus } from '../../hooks/useLlmStatus';
import { useChats } from '../../hooks/useChats';
import { useSelectedSeries } from '../../hooks/useSelectedSeries';
import { ModelCombobox } from './ModelCombobox';
import {
  AbstractConfig,
  DEFAULT_ABSTRACT_DETAIL_LEVEL,
  DEFAULT_ABSTRACT_TOKENS,
  DEFAULT_LMSTUDIO_URL,
  DEFAULT_OLLAMA_URL,
  DEFAULT_RERANKER_CONFIG,
  LlmConfig,
  LlmProvider,
  RERANKER_CAPABLE_PROVIDERS,
  RerankerConfig,
  TestConnectionResult,
} from '@shared/types';
import styles from './SettingsPage.module.css';

const PROVIDER_META: Record<LlmProvider, { name: string; description: string; needsKey: boolean }> =
  {
    [LlmProvider.Anthropic]: {
      name: 'Anthropic',
      description: 'Claude models via api.anthropic.com',
      needsKey: true,
    },
    [LlmProvider.OpenAI]: {
      name: 'OpenAI',
      description: 'GPT models via api.openai.com',
      needsKey: true,
    },
    [LlmProvider.OpenRouter]: {
      name: 'OpenRouter',
      description: 'Many models via openrouter.ai',
      needsKey: true,
    },
    [LlmProvider.Ollama]: {
      name: 'Ollama',
      description: 'Local models, no API key',
      needsKey: false,
    },
    [LlmProvider.LmStudio]: {
      name: 'LM Studio',
      description: 'Local models via LM Studio server',
      needsKey: false,
    },
  };

const OTHER_VALUE = '__other__';

const PROVIDERS_WITH_SPENDING_TIP = new Set<LlmProvider>([
  LlmProvider.Anthropic,
  LlmProvider.OpenAI,
  LlmProvider.OpenRouter,
]);

const PROVIDERS_WITH_LOCAL_MODEL_TIP = new Set<LlmProvider>([
  LlmProvider.Ollama,
  LlmProvider.LmStudio,
]);

interface FormState {
  provider: LlmProvider | null;
  apiKey: string;
  model: string;
  embeddingModel: string;
  ollamaBaseUrl: string;
  lmStudioBaseUrl: string;
}

function initialFormFromConfig(cfg: LlmConfig | null): FormState {
  if (!cfg || !cfg.provider) {
    return {
      provider: null,
      apiKey: '',
      model: '',
      embeddingModel: '',
      ollamaBaseUrl: DEFAULT_OLLAMA_URL,
      lmStudioBaseUrl: DEFAULT_LMSTUDIO_URL,
    };
  }
  return {
    provider: cfg.provider,
    apiKey: '',
    model: cfg.model,
    embeddingModel: cfg.embeddingModel || '',
    ollamaBaseUrl: cfg.ollamaBaseUrl || DEFAULT_OLLAMA_URL,
    lmStudioBaseUrl: cfg.lmStudioBaseUrl || DEFAULT_LMSTUDIO_URL,
  };
}

export function SettingsPage() {
  const { configured, refresh } = useLlmStatus();
  const navigate = useNavigate();
  const { refresh: refreshChats } = useChats();
  const { refresh: refreshSeries } = useSelectedSeries();

  const [loaded, setLoaded] = useState(false);
  const [savedConfig, setSavedConfig] = useState<LlmConfig | null>(null);
  const [form, setForm] = useState<FormState>({
    provider: null,
    apiKey: '',
    model: '',
    embeddingModel: '',
    ollamaBaseUrl: DEFAULT_OLLAMA_URL,
    lmStudioBaseUrl: DEFAULT_LMSTUDIO_URL,
  });
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<TestConnectionResult | null>(null);

  const [abstractForm, setAbstractForm] = useState<AbstractConfig>({
    maxTokensDetailed: DEFAULT_ABSTRACT_TOKENS.detailed,
    maxTokensShort: DEFAULT_ABSTRACT_TOKENS.short,
    maxTokensBook: DEFAULT_ABSTRACT_TOKENS.book,
    detailLevel: DEFAULT_ABSTRACT_DETAIL_LEVEL,
  });
  const [abstractSaving, setAbstractSaving] = useState(false);

  const [rerankerForm, setRerankerForm] = useState<RerankerConfig>(DEFAULT_RERANKER_CONFIG);
  const [customRerankerModel, setCustomRerankerModel] = useState(false);

  const [clearingLogs, setClearingLogs] = useState(false);
  const [resetting, setResetting] = useState(false);

  // Per-provider model memory — preserves selections within the session even without saving
  const [providerModels, setProviderModels] = useState<Partial<Record<LlmProvider, string>>>({});
  const [providerEmbeddingModels, setProviderEmbeddingModels] = useState<Partial<Record<LlmProvider, string>>>({});

  // Model list state — separate per picker type
  const [availableModels, setAvailableModels] = useState<string[]>([]);
  const [availableEmbeddingModels, setAvailableEmbeddingModels] = useState<string[]>([]);
  const [availableRerankerModels, setAvailableRerankerModels] = useState<string[]>([]);
  const [modelsLoading, setModelsLoading] = useState(false);
  const [modelsError, setModelsError] = useState<string | null>(null);
  // true when the model field is in free-text mode (user chose "Other" or model not in list)
  const [customModel, setCustomModel] = useState(false);
  // same for embedding model
  const [customEmbeddingModel, setCustomEmbeddingModel] = useState(false);

  type UrlHealth = 'idle' | 'checking' | 'ok' | 'error';
  const [ollamaUrlHealth, setOllamaUrlHealth] = useState<UrlHealth>('idle');
  const [ollamaUrlHealthDetail, setOllamaUrlHealthDetail] = useState<string | null>(null);
  const [lmStudioUrlHealth, setLmStudioUrlHealth] = useState<UrlHealth>('idle');
  const [lmStudioUrlHealthDetail, setLmStudioUrlHealthDetail] = useState<string | null>(null);

  // Debounce timer for baseUrl changes
  const fetchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ollamaProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lmStudioProbeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    void Promise.all([
      configApi.getLlmConfig(),
      configApi.getAbstractConfig(),
      configApi.getRerankerConfig(),
    ]).then(([cfg, abstractCfg, rerankerCfg]) => {
      setSavedConfig(cfg ?? null);
      setForm(initialFormFromConfig(cfg ?? null));
      // Seed per-provider memory from saved config so switching back restores the saved model
      if (cfg?.provider && cfg?.model) {
        setProviderModels({ [cfg.provider]: cfg.model });
        setProviderEmbeddingModels({ [cfg.provider]: cfg.embeddingModel ?? '' });
      }
      if (abstractCfg) setAbstractForm(abstractCfg);
      if (rerankerCfg) setRerankerForm(rerankerCfg);
      setLoaded(true);
    });
  }, []);

  useEffect(() => {
    if (form.provider !== LlmProvider.Ollama) {
      setOllamaUrlHealth('idle');
      setOllamaUrlHealthDetail(null);
    }
    if (form.provider !== LlmProvider.LmStudio) {
      setLmStudioUrlHealth('idle');
      setLmStudioUrlHealthDetail(null);
    }
  }, [form.provider]);

  useEffect(() => {
    setAvailableModels([]);
    setAvailableEmbeddingModels([]);
    setAvailableRerankerModels([]);
    setModelsError(null);
    setModelsLoading(false);
  }, [form.provider]);

  useEffect(() => {
    if (form.provider !== LlmProvider.Ollama) return;
    const url = form.ollamaBaseUrl;
    let cancelled = false;
    if (!url.trim()) {
      setOllamaUrlHealth('idle');
      setOllamaUrlHealthDetail(null);
      return () => {
        cancelled = true;
      };
    }
    setOllamaUrlHealth('checking');
    setOllamaUrlHealthDetail(null);
    if (ollamaProbeTimerRef.current) clearTimeout(ollamaProbeTimerRef.current);
    ollamaProbeTimerRef.current = setTimeout(() => {
      void configApi
        .probeBaseUrlHealth({ kind: 'ollama', url })
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            setOllamaUrlHealth('ok');
            setOllamaUrlHealthDetail(null);
          } else {
            setOllamaUrlHealth('error');
            setOllamaUrlHealthDetail(r.error ?? 'Unreachable');
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setOllamaUrlHealth('error');
          setOllamaUrlHealthDetail(e instanceof Error ? e.message : String(e));
        });
    }, 350);
    return () => {
      cancelled = true;
      if (ollamaProbeTimerRef.current) {
        clearTimeout(ollamaProbeTimerRef.current);
        ollamaProbeTimerRef.current = null;
      }
    };
  }, [form.provider, form.ollamaBaseUrl]);

  useEffect(() => {
    if (form.provider !== LlmProvider.LmStudio) return;
    const url = form.lmStudioBaseUrl;
    let cancelled = false;
    if (!url.trim()) {
      setLmStudioUrlHealth('idle');
      setLmStudioUrlHealthDetail(null);
      return () => {
        cancelled = true;
      };
    }
    setLmStudioUrlHealth('checking');
    setLmStudioUrlHealthDetail(null);
    if (lmStudioProbeTimerRef.current) clearTimeout(lmStudioProbeTimerRef.current);
    lmStudioProbeTimerRef.current = setTimeout(() => {
      void configApi
        .probeBaseUrlHealth({ kind: 'lmstudio', url })
        .then((r) => {
          if (cancelled) return;
          if (r.ok) {
            setLmStudioUrlHealth('ok');
            setLmStudioUrlHealthDetail(null);
          } else {
            setLmStudioUrlHealth('error');
            setLmStudioUrlHealthDetail(r.error ?? 'Unreachable');
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setLmStudioUrlHealth('error');
          setLmStudioUrlHealthDetail(e instanceof Error ? e.message : String(e));
        });
    }, 350);
    return () => {
      cancelled = true;
      if (lmStudioProbeTimerRef.current) {
        clearTimeout(lmStudioProbeTimerRef.current);
        lmStudioProbeTimerRef.current = null;
      }
    };
  }, [form.provider, form.lmStudioBaseUrl]);

  // Fetch all three model lists when provider / URLs / URL health allow it
  useEffect(() => {
    if (!form.provider) return;

    if (form.provider === LlmProvider.Ollama && ollamaUrlHealth !== 'ok') {
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    if (form.provider === LlmProvider.LmStudio && lmStudioUrlHealth !== 'ok') {
      setModelsError(null);
      setModelsLoading(false);
      return;
    }

    if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    fetchDebounceRef.current = setTimeout(() => {
      void fetchAllModels(form.provider!, form.ollamaBaseUrl, form.lmStudioBaseUrl);
    }, 300);

    return () => {
      if (fetchDebounceRef.current) clearTimeout(fetchDebounceRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    form.provider,
    form.ollamaBaseUrl,
    form.lmStudioBaseUrl,
    ollamaUrlHealth,
    lmStudioUrlHealth,
  ]);

  // When chat model list arrives, re-evaluate free-text mode for main model
  useEffect(() => {
    if (availableModels.length === 0) return;
    setCustomModel(!availableModels.includes(form.model) && form.model.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableModels]);

  // When embedding model list arrives, re-evaluate free-text mode
  useEffect(() => {
    if (availableEmbeddingModels.length === 0) return;
    setCustomEmbeddingModel(!availableEmbeddingModels.includes(form.embeddingModel) && form.embeddingModel.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableEmbeddingModels]);

  // When reranker model list arrives, re-evaluate free-text mode
  useEffect(() => {
    if (availableRerankerModels.length === 0) return;
    setCustomRerankerModel(!availableRerankerModels.includes(rerankerForm.model) && rerankerForm.model.length > 0);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [availableRerankerModels]);

  async function fetchAllModels(
    provider: LlmProvider,
    ollamaBaseUrl: string,
    lmStudioBaseUrl: string,
  ) {
    setModelsLoading(true);
    setModelsError(null);
    try {
      const base = { provider, ollamaBaseUrl, lmStudioBaseUrl };
      const [chat, embedding, reranker] = await Promise.allSettled([
        configApi.listModels({ ...base, modelType: 'chat' }),
        configApi.listModels({ ...base, modelType: 'embedding' }),
        configApi.listModels({ ...base, modelType: 'reranker' }),
      ]);
      setAvailableModels(chat.status === 'fulfilled' ? (chat.value?.models ?? []) : []);
      setAvailableEmbeddingModels(embedding.status === 'fulfilled' ? (embedding.value?.models ?? []) : []);
      setAvailableRerankerModels(reranker.status === 'fulfilled' ? (reranker.value?.models ?? []) : []);
      if (chat.status === 'rejected') {
        setModelsError(chat.reason instanceof Error ? chat.reason.message : 'Failed to load models');
      }
    } finally {
      setModelsLoading(false);
    }
  }

  function handleModelSelect(value: string) {
    if (value === OTHER_VALUE) {
      setCustomModel(true);
      setForm((f) => ({ ...f, model: '' }));
      return;
    }
    setCustomModel(false);
    setForm((f) => ({ ...f, model: value }));

    // Trigger model load in background for local providers
    if (form.provider === LlmProvider.Ollama && ollamaUrlHealth !== 'ok') return;
    if (form.provider === LlmProvider.LmStudio && lmStudioUrlHealth !== 'ok') return;
    if (
      form.provider === LlmProvider.Ollama ||
      form.provider === LlmProvider.LmStudio
    ) {
      void configApi.loadModel({
        provider: form.provider,
        model: value,
        ollamaBaseUrl: form.ollamaBaseUrl,
        lmStudioBaseUrl: form.lmStudioBaseUrl,
      });
    }
  }

  const meta = form.provider ? PROVIDER_META[form.provider] : null;
  const needsKey = meta?.needsKey ?? false;
  const keyAlreadySet = form.provider ? (savedConfig?.keysSet?.[form.provider] ?? false) : false;

  const canSubmit =
    form.provider !== null &&
    form.model.trim().length > 0 &&
    (!needsKey || form.apiKey.length > 0 || keyAlreadySet) &&
    (form.provider !== LlmProvider.Ollama || form.ollamaBaseUrl.length > 0) &&
    (form.provider !== LlmProvider.LmStudio || form.lmStudioBaseUrl.length > 0);

  async function handleSave(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit || !form.provider) return;
    setSaving(true);
    setTestResult(null);
    try {
      const cfg = await configApi.saveLlmConfig({
        provider: form.provider,
        model: form.model,
        embeddingModel: form.embeddingModel.trim() || undefined,
        apiKey: form.apiKey.length > 0 ? form.apiKey : undefined,
        ollamaBaseUrl: form.provider === LlmProvider.Ollama ? form.ollamaBaseUrl : undefined,
        lmStudioBaseUrl: form.provider === LlmProvider.LmStudio ? form.lmStudioBaseUrl : undefined,
      });
      if (RERANKER_CAPABLE_PROVIDERS.includes(form.provider)) {
        const savedReranker = await configApi.saveRerankerConfig(rerankerForm);
        if (savedReranker) setRerankerForm(savedReranker);
      }
      setSavedConfig(cfg ?? null);
      if (cfg?.provider && cfg?.model) {
        setProviderModels((prev) => ({ ...prev, [cfg.provider!]: cfg.model }));
        setProviderEmbeddingModels((prev) => ({ ...prev, [cfg.provider!]: cfg.embeddingModel ?? '' }));
      }
      setForm((f) => ({ ...f, apiKey: '' }));
      await refresh();
    } finally {
      setSaving(false);
    }
  }

  async function handleTest() {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await configApi.testLlmConnection();
      setTestResult(result ?? null);
    } catch (err) {
      setTestResult({ success: false, error: err instanceof Error ? err.message : String(err) });
    } finally {
      setTesting(false);
    }
  }

  if (!loaded) return <div className={styles.wrap}><div className={styles.page}>Loading…</div></div>;

  // Determine select values for both model fields
  const selectValue = customModel
    ? OTHER_VALUE
    : availableModels.includes(form.model)
    ? form.model
    : availableModels.length > 0 && form.model.length > 0
    ? OTHER_VALUE  // model was set but not found in list
    : '';

  const embeddingSelectValue = customEmbeddingModel
    ? OTHER_VALUE
    : availableEmbeddingModels.includes(form.embeddingModel)
    ? form.embeddingModel
    : availableEmbeddingModels.length > 0 && form.embeddingModel.length > 0
    ? OTHER_VALUE
    : '';

  const rerankerSelectValue = customRerankerModel
    ? OTHER_VALUE
    : availableRerankerModels.includes(rerankerForm.model)
    ? rerankerForm.model
    : availableRerankerModels.length > 0 && rerankerForm.model.length > 0
    ? OTHER_VALUE
    : '';

  return (
    <div className={styles.wrap}>
    <form className={styles.page} onSubmit={handleSave}>
      {configured === false && (
        <div className={styles.banner}>
          Configuration required — select a provider and complete setup to unlock the rest of the
          app.
        </div>
      )}

      <div className={styles.section}>
        <div className={styles.sectionTitle}>Provider</div>
        <div className={styles.providerGrid}>
          {(Object.values(LlmProvider) as LlmProvider[]).map((p) => {
            const m = PROVIDER_META[p];
            const active = form.provider === p;
            return (
              <button
                key={p}
                type="button"
                className={`${styles.providerCard} ${active ? styles.providerCardActive : ''}`}
                onClick={() => {
                  // Persist current selections before switching
                  if (form.provider) {
                    setProviderModels((prev) => ({ ...prev, [form.provider!]: form.model }));
                    setProviderEmbeddingModels((prev) => ({ ...prev, [form.provider!]: form.embeddingModel }));
                  }
                  setCustomModel(false);
                  setCustomEmbeddingModel(false);
                  setAvailableModels([]);
                  setForm((f) => ({
                    ...f,
                    provider: p,
                    // Restore: session memory first, then savedConfig, then blank
                    model: providerModels[p] ?? (savedConfig?.provider === p ? savedConfig.model : ''),
                    embeddingModel: providerEmbeddingModels[p] ?? (savedConfig?.provider === p ? (savedConfig.embeddingModel ?? '') : ''),
                  }));
                }}
              >
                <div className={styles.providerName}>{m.name}</div>
                <div className={styles.providerDesc}>{m.description}</div>
              </button>
            );
          })}
        </div>
      </div>

      {form.provider && (
        <>
          {needsKey && (
            <div className={styles.section}>
              <label className={styles.label} htmlFor="apiKey">
                API Key
              </label>
              <input
                id="apiKey"
                className={styles.input}
                type="password"
                autoComplete="off"
                spellCheck={false}
                placeholder={keyAlreadySet ? '•••••• (stored — leave blank to keep)' : 'Enter API key'}
                value={form.apiKey}
                onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
              />
              <div className={styles.helper}>
                Stored locally, encrypted with a key tied to your OS login session (no prompt required).
              </div>
            </div>
          )}

          {form.provider && PROVIDERS_WITH_SPENDING_TIP.has(form.provider) && (
            <div className={styles.spendingTip} role="note">
              <span className={styles.spendingTipIcon} aria-hidden>
                💡
              </span>
              <div>
                <div className={styles.spendingTipLabel}>Pro tip</div>
                <p className={styles.spendingTipText}>
                  Set a spending limit (or budget cap) in your provider&apos;s account dashboard. A
                  mis-click while retrying work — for example regenerating abstracts with an expensive
                  model already selected — can otherwise produce a very large bill.
                </p>
              </div>
            </div>
          )}

          {form.provider === LlmProvider.Ollama && (
            <div className={styles.section}>
              <label className={styles.label} htmlFor="ollamaUrl">
                Ollama Base URL
              </label>
              <div className={styles.urlFieldRow}>
                <input
                  id="ollamaUrl"
                  className={styles.input}
                  type="text"
                  value={form.ollamaBaseUrl}
                  onChange={(e) => setForm((f) => ({ ...f, ollamaBaseUrl: e.target.value }))}
                />
                <span
                  className={`${styles.urlHealthDot} ${
                    ollamaUrlHealth === 'idle'
                      ? styles.urlHealth_idle
                      : ollamaUrlHealth === 'checking'
                        ? styles.urlHealth_checking
                        : ollamaUrlHealth === 'ok'
                          ? styles.urlHealth_ok
                          : styles.urlHealth_error
                  }`}
                  title={
                    ollamaUrlHealth === 'ok'
                      ? 'Server reachable'
                      : ollamaUrlHealth === 'error'
                        ? ollamaUrlHealthDetail ?? 'Unreachable'
                        : ollamaUrlHealth === 'checking'
                          ? 'Checking…'
                          : 'Enter a base URL'
                  }
                  aria-hidden
                />
              </div>
            </div>
          )}

          {form.provider === LlmProvider.LmStudio && (
            <>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="lmStudioUrl">
                  LM Studio Base URL
                </label>
                <div className={styles.urlFieldRow}>
                  <input
                    id="lmStudioUrl"
                    className={styles.input}
                    type="text"
                    value={form.lmStudioBaseUrl}
                    onChange={(e) => setForm((f) => ({ ...f, lmStudioBaseUrl: e.target.value }))}
                  />
                  <span
                    className={`${styles.urlHealthDot} ${
                      lmStudioUrlHealth === 'idle'
                        ? styles.urlHealth_idle
                        : lmStudioUrlHealth === 'checking'
                          ? styles.urlHealth_checking
                          : lmStudioUrlHealth === 'ok'
                            ? styles.urlHealth_ok
                            : styles.urlHealth_error
                    }`}
                    title={
                      lmStudioUrlHealth === 'ok'
                        ? 'Server reachable'
                        : lmStudioUrlHealth === 'error'
                          ? lmStudioUrlHealthDetail ?? 'Unreachable'
                          : lmStudioUrlHealth === 'checking'
                            ? 'Checking…'
                            : 'Enter a base URL'
                    }
                    aria-hidden
                  />
                </div>
              </div>
              <div className={styles.section}>
                <label className={styles.label} htmlFor="lmStudioKey">
                  API Key <span className={styles.helper}>(optional)</span>
                </label>
                <input
                  id="lmStudioKey"
                  className={styles.input}
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  placeholder={keyAlreadySet ? '•••••• (stored — leave blank to keep)' : 'Leave blank if not required'}
                  value={form.apiKey}
                  onChange={(e) => setForm((f) => ({ ...f, apiKey: e.target.value }))}
                />
              </div>
            </>
          )}

          {form.provider && PROVIDERS_WITH_LOCAL_MODEL_TIP.has(form.provider) && (
            <div className={styles.spendingTip} role="note">
              <span className={styles.spendingTipIcon} aria-hidden>
                💡
              </span>
              <div>
                <div className={styles.spendingTipLabel}>Pro tip</div>
                <p className={styles.spendingTipText}>
                  Small models are tempting because they are cheap to run, but many are too limited for
                  writing abstracts, using tools, and following rules reliably. That can produce
                  unpredictable results: empty replies, garbled output, or errors. Prefer a larger
                  capable model when quality and stability matter.
                </p>
              </div>
            </div>
          )}

          {/* ── Model picker ── */}
          <div className={styles.section}>
            <div className={styles.labelRow}>
              <label className={styles.label} htmlFor="model">Model</label>
              {modelsLoading && <span className={styles.loadingDot}>⟳</span>}
              {modelsError && (
                <span className={styles.modelsError} title={modelsError}>
                  ⚠ could not load list
                </span>
              )}
            </div>

            {/* Combobox: shown when models are available OR loading */}
            {availableModels.length > 0 && !customModel && (
              availableModels.length > 20 ? (
                <ModelCombobox
                  id="model"
                  models={availableModels}
                  value={form.model}
                  placeholder="Select a model"
                  onChange={(v) => handleModelSelect(v)}
                  onOther={() => handleModelSelect(OTHER_VALUE)}
                />
              ) : (
                <select
                  id="model"
                  className={styles.select}
                  value={selectValue}
                  onChange={(e) => handleModelSelect(e.target.value)}
                >
                  <option value="" disabled>Select a model</option>
                  {availableModels.map((m) => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                  <option value={OTHER_VALUE}>Other…</option>
                </select>
              )
            )}

            {/* Free-text input: shown when "Other" is selected, model not in list, or no list available */}
            {(customModel || availableModels.length === 0) && (
              <div className={styles.modelInputRow}>
                <input
                  id="model"
                  className={styles.input}
                  type="text"
                  placeholder={
                    form.provider === LlmProvider.Ollama
                      ? 'e.g. llama3.2'
                      : form.provider === LlmProvider.OpenRouter
                      ? 'e.g. anthropic/claude-sonnet-4'
                      : 'Model name'
                  }
                  value={form.model}
                  onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))}
                  autoFocus={customModel}
                />
                {customModel && availableModels.length > 0 && (
                  <button
                    type="button"
                    className={styles.backToListBtn}
                    onClick={() => {
                      setCustomModel(false);
                      setForm((f) => ({ ...f, model: availableModels[0] ?? '' }));
                    }}
                  >
                    ← list
                  </button>
                )}
              </div>
            )}
          </div>

          {form.provider !== LlmProvider.Anthropic && (
            <div className={styles.section}>
              <label className={styles.label} htmlFor="embeddingModel">
                Embedding Model
              </label>

              {availableEmbeddingModels.length > 0 && !customEmbeddingModel && (
                availableEmbeddingModels.length > 20 ? (
                  <ModelCombobox
                    id="embeddingModel"
                    models={availableEmbeddingModels}
                    value={form.embeddingModel}
                    placeholder="Select an embedding model"
                    onChange={(val) => {
                      setCustomEmbeddingModel(false);
                      setForm((f) => ({ ...f, embeddingModel: val }));
                    }}
                    onOther={() => {
                      setCustomEmbeddingModel(true);
                      setForm((f) => ({ ...f, embeddingModel: '' }));
                    }}
                  />
                ) : (
                  <select
                    id="embeddingModel"
                    className={styles.select}
                    value={embeddingSelectValue}
                    onChange={(e) => {
                      const val = e.target.value;
                      if (val === OTHER_VALUE) {
                        setCustomEmbeddingModel(true);
                        setForm((f) => ({ ...f, embeddingModel: '' }));
                      } else {
                        setCustomEmbeddingModel(false);
                        setForm((f) => ({ ...f, embeddingModel: val }));
                      }
                    }}
                  >
                    <option value="" disabled>Select an embedding model</option>
                    {availableEmbeddingModels.map((m) => (
                      <option key={m} value={m}>{m}</option>
                    ))}
                    <option value={OTHER_VALUE}>Other…</option>
                  </select>
                )
              )}

              {(customEmbeddingModel || availableEmbeddingModels.length === 0) && (
                <div className={styles.modelInputRow}>
                  <input
                    id="embeddingModel"
                    className={styles.input}
                    type="text"
                    placeholder={
                      form.provider === LlmProvider.Ollama
                        ? 'e.g. nomic-embed-text'
                        : 'e.g. text-embedding-3-small'
                    }
                    value={form.embeddingModel}
                    onChange={(e) => setForm((f) => ({ ...f, embeddingModel: e.target.value }))}
                    autoFocus={customEmbeddingModel}
                  />
                  {customEmbeddingModel && availableEmbeddingModels.length > 0 && (
                    <button
                      type="button"
                      className={styles.backToListBtn}
                      onClick={() => {
                        setCustomEmbeddingModel(false);
                        setForm((f) => ({ ...f, embeddingModel: availableEmbeddingModels[0] ?? '' }));
                      }}
                    >
                      ← list
                    </button>
                  )}
                </div>
              )}

              <div className={styles.helper}>
                Must be an embedding model, not a chat model. Used for semantic search.
              </div>
            </div>
          )}

          {/* ── Reranker (capable providers only) ── */}
          {RERANKER_CAPABLE_PROVIDERS.includes(form.provider) && (
            <div className={styles.section}>
              <div className={styles.rerankerHeader}>
                Reranker
                <label className={styles.checkboxLabel}>
                  <input
                    type="checkbox"
                    checked={rerankerForm.enabled}
                    onChange={(e) => setRerankerForm((f) => ({ ...f, enabled: e.target.checked }))}
                  />
                  Enable in chat
                </label>
              </div>
              {rerankerForm.enabled && (
                <>
                  <div className={styles.helper}>
                    Re-scores retrieved passages with a cross-encoder before answering.
                    Retrieves <em>top-K × multiplier</em> candidates, then reranks to top-K.
                  </div>
                  <div className={styles.labelRow}>
                    <label className={styles.label} htmlFor="rerankerModel">Reranker model</label>
                  </div>
                  {availableRerankerModels.length > 0 && !customRerankerModel && (
                    availableRerankerModels.length > 20 ? (
                      <ModelCombobox
                        id="rerankerModel"
                        models={availableRerankerModels}
                        value={rerankerForm.model}
                        placeholder="Select a reranker model"
                        onChange={(val) => {
                          setCustomRerankerModel(false);
                          setRerankerForm((f) => ({ ...f, model: val }));
                        }}
                        onOther={() => {
                          setCustomRerankerModel(true);
                          setRerankerForm((f) => ({ ...f, model: '' }));
                        }}
                      />
                    ) : (
                      <select
                        id="rerankerModel"
                        className={styles.select}
                        value={rerankerSelectValue}
                        onChange={(e) => {
                          const val = e.target.value;
                          if (val === OTHER_VALUE) {
                            setCustomRerankerModel(true);
                            setRerankerForm((f) => ({ ...f, model: '' }));
                          } else {
                            setCustomRerankerModel(false);
                            setRerankerForm((f) => ({ ...f, model: val }));
                          }
                        }}
                      >
                        <option value="" disabled>Select a reranker model</option>
                        {availableRerankerModels.map((m) => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                        <option value={OTHER_VALUE}>Other…</option>
                      </select>
                    )
                  )}
                  {(customRerankerModel || availableRerankerModels.length === 0) && (
                    <div className={styles.modelInputRow}>
                      <input
                        id="rerankerModel"
                        className={styles.input}
                        type="text"
                        placeholder={
                          form.provider === LlmProvider.Ollama
                            ? 'e.g. bge-reranker-v2-m3'
                            : 'e.g. cohere/rerank-v3.5'
                        }
                        value={rerankerForm.model}
                        onChange={(e) => setRerankerForm((f) => ({ ...f, model: e.target.value }))}
                        autoFocus={customRerankerModel}
                      />
                      {customRerankerModel && availableRerankerModels.length > 0 && (
                        <button
                          type="button"
                          className={styles.backToListBtn}
                          onClick={() => {
                            setCustomRerankerModel(false);
                            setRerankerForm((f) => ({ ...f, model: availableRerankerModels[0] ?? '' }));
                          }}
                        >
                          ← list
                        </button>
                      )}
                    </div>
                  )}
                  <div className={styles.tokenField}>
                    <label className={styles.label} htmlFor="rerankerMultiplier">Top-K multiplier</label>
                    <input
                      id="rerankerMultiplier"
                      className={styles.input}
                      type="number"
                      min={1}
                      max={10}
                      step={0.5}
                      value={rerankerForm.topKMultiplier}
                      onChange={(e) =>
                        setRerankerForm((f) => ({
                          ...f,
                          topKMultiplier: Math.max(1, parseFloat(e.target.value) || 2),
                        }))
                      }
                    />
                  </div>
                </>
              )}
            </div>
          )}

          <div className={styles.actions}>
            <button type="submit" className={styles.button} disabled={!canSubmit || saving}>
              {saving ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonSecondary}`}
              disabled={testing || !savedConfig?.provider}
              onClick={handleTest}
            >
              {testing ? (
                <>
                  <span className={styles.spinner} /> Testing…
                </>
              ) : (
                'Test Connection'
              )}
            </button>
            {configured && (
              <button
                type="button"
                className={`${styles.button} ${styles.buttonSecondary}`}
                onClick={() => navigate('/chat')}
              >
                Continue →
              </button>
            )}
          </div>

          {testResult && (
            <div
              className={`${styles.result} ${
                testResult.success ? styles.resultSuccess : styles.resultError
              }`}
            >
              {testResult.success
                ? '✓ Connection established'
                : `✗ ${testResult.error ?? 'Unknown error'}`}
            </div>
          )}
        </>
      )}
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Abstract Generation</div>
        <div className={styles.fieldGroup}>
          <label className={styles.label} htmlFor="detailLevel">
            Detail level — {['', 'Concise', 'Default', 'Exhaustive'][abstractForm.detailLevel]}
          </label>
          <input
            id="detailLevel"
            type="range"
            min={1}
            max={3}
            step={1}
            value={abstractForm.detailLevel}
            onChange={(e) => setAbstractForm((f) => ({ ...f, detailLevel: parseInt(e.target.value, 10) }))}
            className={styles.slider}
          />
          <div className={styles.sliderLabels}>
            <span>Concise</span>
            <span>Default</span>
            <span>Exhaustive</span>
          </div>
        </div>
        <div className={styles.tokenRow}>
          <div className={styles.tokenField}>
            <label className={styles.label} htmlFor="absDetailed">Detailed summary</label>
            <input
              id="absDetailed"
              className={styles.input}
              type="number"
              min={100}
              step={100}
              value={abstractForm.maxTokensDetailed}
              onChange={(e) => setAbstractForm((f) => ({ ...f, maxTokensDetailed: parseInt(e.target.value, 10) || DEFAULT_ABSTRACT_TOKENS.detailed }))}
            />
          </div>
          <div className={styles.tokenField}>
            <label className={styles.label} htmlFor="absShort">Short summary</label>
            <input
              id="absShort"
              className={styles.input}
              type="number"
              min={100}
              step={100}
              value={abstractForm.maxTokensShort}
              onChange={(e) => setAbstractForm((f) => ({ ...f, maxTokensShort: parseInt(e.target.value, 10) || DEFAULT_ABSTRACT_TOKENS.short }))}
            />
          </div>
          <div className={styles.tokenField}>
            <label className={styles.label} htmlFor="absBook">Book overview</label>
            <input
              id="absBook"
              className={styles.input}
              type="number"
              min={100}
              step={100}
              value={abstractForm.maxTokensBook}
              onChange={(e) => setAbstractForm((f) => ({ ...f, maxTokensBook: parseInt(e.target.value, 10) || DEFAULT_ABSTRACT_TOKENS.book }))}
            />
          </div>
        </div>
        <div className={styles.helper}>Max tokens per LLM call for each abstract step. Defaults: {DEFAULT_ABSTRACT_TOKENS.detailed} / {DEFAULT_ABSTRACT_TOKENS.short} / {DEFAULT_ABSTRACT_TOKENS.book}.</div>
        <div>
          <button
            type="button"
            className={styles.button}
            disabled={abstractSaving}
            onClick={async () => {
              setAbstractSaving(true);
              try {
                const saved = await configApi.saveAbstractConfig(abstractForm);
                if (saved) setAbstractForm(saved);
              } finally {
                setAbstractSaving(false);
              }
            }}
          >
            {abstractSaving ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <div className={styles.section}>
        <div className={styles.sectionTitle}>Data Management</div>
        <div className={styles.dangerRow}>
          <div className={styles.dangerItem}>
            <div className={styles.dangerLabel}>Clear logs</div>
            <div className={styles.helper}>Deletes the app log file and all LLM call records.</div>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonDanger}`}
              disabled={clearingLogs}
              onClick={async () => {
                if (!window.confirm('Clear all logs and LLM call history? This cannot be undone.')) return;
                setClearingLogs(true);
                try {
                  await dataApi.clearLogs();
                } finally {
                  setClearingLogs(false);
                }
              }}
            >
              {clearingLogs ? 'Clearing…' : 'Clear Logs'}
            </button>
          </div>
          <div className={styles.dangerItem}>
            <div className={styles.dangerLabel}>Reset all data</div>
            <div className={styles.helper}>
              Removes all books, series, chats, jobs, logs, and settings including API keys.
            </div>
            <button
              type="button"
              className={`${styles.button} ${styles.buttonDanger}`}
              disabled={resetting}
              onClick={async () => {
                if (!window.confirm('This will permanently delete all books, series, chats, jobs, logs, and settings including API keys.\n\nContinue?')) return;
                setResetting(true);
                try {
                  await dataApi.resetAllData();
                  await Promise.all([refreshChats(), refreshSeries(), refresh()]);
                  navigate('/');
                } finally {
                  setResetting(false);
                }
              }}
            >
              {resetting ? 'Resetting…' : 'Reset All Data'}
            </button>
          </div>
        </div>
      </div>
    </form>
    </div>
  );
}
