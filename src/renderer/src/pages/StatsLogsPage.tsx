import { useCallback, useEffect, useRef, useState } from 'react';
import type { CostPrices, LlmCall, LlmStatRow, LogLevel, StatsPayload } from '@shared/types';
import { logsApi } from '../api/chat-api';
import { statsApi } from '../api/stats-api';
import { useInspector } from '../hooks/useInspector';
import styles from './StatsLogsPage.module.css';

type Tab = 'app' | 'llm' | 'stats';

const LEVELS: LogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal'];

interface AppLogRow {
  time: number;
  level: LogLevel;
  msg: string;
  [key: string]: unknown;
}

export function StatsLogsPage() {
  const [tab, setTab] = useState<Tab>('stats');
  const [level, setLevel] = useState<LogLevel>('debug');
  const [appLog, setAppLog] = useState<AppLogRow[]>([]);
  const [llmCalls, setLlmCalls] = useState<LlmCall[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      if (tab === 'app') {
        const rows = (await logsApi.app(level, 500)) as unknown as AppLogRow[];
        setAppLog(rows);
      } else if (tab === 'llm') {
        const rows = await logsApi.llm(200);
        setLlmCalls(rows);
      }
    } finally {
      setLoading(false);
    }
  }, [tab, level]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <div className={styles.page}>
      <div className={styles.tabs}>
      <button
          type="button"
          className={`${styles.tab} ${tab === 'stats' ? styles.tabActive : ''}`}
          onClick={() => setTab('stats')}
        >
          Stats
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'llm' ? styles.tabActive : ''}`}
          onClick={() => setTab('llm')}
        >
          LLM Calls
        </button>
        <button
          type="button"
          className={`${styles.tab} ${tab === 'app' ? styles.tabActive : ''}`}
          onClick={() => setTab('app')}
        >
          App Log
        </button>
      </div>

      {tab !== 'stats' && (
        <div className={styles.toolbar}>
          {tab === 'app' && (
            <label>
              level
              <select
                className={styles.select}
                value={level}
                onChange={(e) => setLevel(e.target.value as LogLevel)}
              >
                {LEVELS.map((l) => (
                  <option key={l} value={l}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
          )}
          <span>{loading ? 'loading…' : ''}</span>
          <button type="button" className={styles.refreshBtn} onClick={() => void refresh()}>
            ↻ refresh
          </button>
        </div>
      )}

      <div className={styles.list}>
        {tab === 'app' && <AppLogList rows={appLog} />}
        {tab === 'llm' && <LlmCallList rows={llmCalls} />}
        {tab === 'stats' && <StatsPanel />}
      </div>
    </div>
  );
}

// ── App log ───────────────────────────────────────────────────────────────────

function AppLogList({ rows }: { rows: AppLogRow[] }) {
  if (rows.length === 0) return <div className={styles.empty}>No log entries.</div>;
  return (
    <>
      {rows.map((r, i) => (
        <div key={i} className={styles.row}>
          <div className={styles.time}>{formatTime(r.time)}</div>
          <div className={`${styles.level} ${levelClass(r.level)}`}>{r.level}</div>
          <div>
            <div className={styles.msg}>{r.msg}</div>
            <MetaLine row={r} />
          </div>
        </div>
      ))}
    </>
  );
}

function MetaLine({ row }: { row: AppLogRow }) {
  const skip = new Set(['time', 'level', 'msg', 'pid', 'hostname', 'app', 'v']);
  const entries = Object.entries(row).filter(([k]) => !skip.has(k));
  if (entries.length === 0) return null;
  return (
    <div className={styles.meta}>
      {entries.map(([k, v]) => `${k}=${formatMetaValue(v)}`).join('  ')}
    </div>
  );
}

function formatMetaValue(v: unknown): string {
  if (v == null) return String(v);
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

// ── LLM call list ─────────────────────────────────────────────────────────────

function LlmCallList({ rows }: { rows: LlmCall[] }) {
  const { openInspector } = useInspector();
  if (rows.length === 0) return <div className={styles.empty}>No LLM calls logged.</div>;
  return (
    <>
      {rows.map((c) => (
        <div
          key={c.id}
          className={styles.llmRow}
          onClick={() => openInspector(c.id)}
          title="Click to inspect"
        >
          <div className={styles.time}>{formatTime(Date.parse(c.createdAt))}</div>
          <div
            className={c.purpose === 'chat' ? styles.llmPurposeChat : styles.llmPurposeTitle}
          >
            {c.purpose}
          </div>
          <div className={styles.msg}>
            <div>
              {c.provider} / {c.model}
            </div>
            {c.error && <div className={styles.llmErr}>{c.error}</div>}
          </div>
          <div>{c.promptTokens ?? '—'}p</div>
          <div>{c.completionTokens ?? '—'}c</div>
          <div>{c.latencyMs != null ? `${c.latencyMs} ms` : '—'}</div>
          <span className={styles.inspectDot} title="Inspect">◈</span>
        </div>
      ))}
    </>
  );
}

// ── Stats panel ───────────────────────────────────────────────────────────────

function StatsPanel() {
  const [data, setData] = useState<StatsPayload | null>(null);
  const [prices, setPrices] = useState<CostPrices>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    Promise.all([statsApi.get(), statsApi.getCostPrices()])
      .then(([stats, p]) => {
        setData(stats);
        setPrices(p);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className={styles.statsLoading}>Loading…</div>;
  if (!data) return <div className={styles.empty}>Failed to load stats.</div>;

  return (
    <div className={styles.statsWrap}>
      <OverviewSection overview={data.overview} />
      <TokenSection title="By Purpose" rows={data.byPurpose} showSubKey={false} />
      <TokenSection title="By Model" rows={data.byModel} showSubKey={true} />
      <CostSection rows={data.byModel} prices={prices} onPricesChange={setPrices} />
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function OverviewSection({ overview: o }: { overview: StatsPayload['overview'] }) {
  return (
    <section className={styles.statsSection}>
      <div className={styles.statsSectionTitle}>Overview</div>
      <div className={styles.overviewGrid}>
        <StatTile label="Chats" value={o.chats} />
        <StatTile label="User msgs" value={o.messagesUser} />
        <StatTile label="Asst msgs" value={o.messagesAssistant} />
        <StatTile label="LLM calls" value={o.llmCallsTotal} />
        <StatTile label="Call errors" value={o.llmCallsError} accent={o.llmCallsError > 0} />
        <StatTile label="Series" value={o.series} />
        <StatTile label="Books" value={o.books} />
        <StatTile label="Chunks" value={o.chunks} />
        <StatTile label="Abstracts" value={o.abstracts} />
        <StatTile label="Total words" value={fmtNum(o.totalWords)} />
        <StatTile label="DB size" value={fmtBytes(o.dbSizeBytes)} />
        <StatTile label="RAG size ~" value={fmtBytes(o.ragSizeBytes)} />
        <StatTile label="Log size" value={fmtBytes(o.logSizeBytes)} />
      </div>
    </section>
  );
}

function StatTile({ label, value, accent }: { label: string; value: string | number; accent?: boolean }) {
  return (
    <div className={styles.statTile}>
      <div className={`${styles.statTileValue} ${accent ? styles.statTileAccentError : ''}`}>
        {value}
      </div>
      <div className={styles.statTileLabel}>{label}</div>
    </div>
  );
}

// ── Token usage table ─────────────────────────────────────────────────────────

function TokenSection({ title, rows, showSubKey }: { title: string; rows: LlmStatRow[]; showSubKey: boolean }) {
  if (rows.length === 0) return null;

  const totalIn = rows.reduce((s, r) => s + r.promptTokens, 0);
  const totalOut = rows.reduce((s, r) => s + r.completionTokens, 0);
  const totalCalls = rows.reduce((s, r) => s + r.calls, 0);

  return (
    <section className={styles.statsSection}>
      <div className={styles.statsSectionTitle}>Token Usage — {title}</div>
      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th>{showSubKey ? 'Model' : 'Purpose'}</th>
            {showSubKey && <th>Provider</th>}
            <th className={styles.thRight}>Calls</th>
            <th className={styles.thRight}>Errors</th>
            <th className={styles.thRight}>Input tok</th>
            <th className={styles.thRight}>Output tok</th>
            <th className={styles.thRight}>Avg ms</th>
            <th className={styles.thRight}>Min ms</th>
            <th className={styles.thRight}>Max ms</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={`${r.key}-${r.subKey}`}>
              <td>{r.key}</td>
              {showSubKey && <td className={styles.tdMuted}>{r.subKey}</td>}
              <td className={styles.tdRight}>{fmtNum(r.calls)}</td>
              <td className={`${styles.tdRight} ${r.errors > 0 ? styles.tdError : ''}`}>
                {r.errors || '—'}
              </td>
              <td className={styles.tdRight}>{fmtNum(r.promptTokens)}</td>
              <td className={styles.tdRight}>{fmtNum(r.completionTokens)}</td>
              <td className={styles.tdRight}>{r.avgLatencyMs != null ? fmtNum(r.avgLatencyMs) : '—'}</td>
              <td className={styles.tdRight}>{r.minLatencyMs != null ? fmtNum(r.minLatencyMs) : '—'}</td>
              <td className={styles.tdRight}>{r.maxLatencyMs != null ? fmtNum(r.maxLatencyMs) : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={showSubKey ? 2 : 1} className={styles.tfootLabel}>Total</td>
            <td className={styles.tdRight}>{fmtNum(totalCalls)}</td>
            <td />
            <td className={styles.tdRight}>{fmtNum(totalIn)}</td>
            <td className={styles.tdRight}>{fmtNum(totalOut)}</td>
            <td colSpan={3} />
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// ── Cost estimator ────────────────────────────────────────────────────────────

function CostSection({
  rows,
  prices,
  onPricesChange,
}: {
  rows: LlmStatRow[];
  prices: CostPrices;
  onPricesChange: (p: CostPrices) => void;
}) {
  if (rows.length === 0) return null;

  // Debounce ref to avoid hammering the backend on every keystroke
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleChange(model: string, field: 'input' | 'output', raw: string) {
    const val = parseFloat(raw) || 0;
    const next = {
      ...prices,
      [model]: { ...(prices[model] ?? { input: 0, output: 0 }), [field]: val },
    };
    onPricesChange(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void statsApi.putCostPrices(next), 800);
  }

  let grandTotal = 0;
  const modelRows = rows.map((r) => {
    const p = prices[r.key] ?? { input: 0, output: 0 };
    const cost = (r.promptTokens * p.input + r.completionTokens * p.output) / 1_000_000;
    grandTotal += cost;
    return { ...r, inputPrice: p.input, outputPrice: p.output, cost };
  });

  return (
    <section className={styles.statsSection}>
      <div className={styles.statsSectionTitle}>Cost Estimator</div>
      <div className={styles.costNote}>
        Enter pricing in USD per 1 M tokens. Values are saved between launches.
      </div>
      <table className={styles.statsTable}>
        <thead>
          <tr>
            <th>Model</th>
            <th>Provider</th>
            <th className={styles.thRight}>Input tok</th>
            <th className={styles.thRight}>Output tok</th>
            <th className={styles.thRight}>$/M input</th>
            <th className={styles.thRight}>$/M output</th>
            <th className={styles.thRight}>Est. cost</th>
          </tr>
        </thead>
        <tbody>
          {modelRows.map((r) => (
            <tr key={r.key}>
              <td>{r.key}</td>
              <td className={styles.tdMuted}>{r.subKey}</td>
              <td className={styles.tdRight}>{fmtNum(r.promptTokens)}</td>
              <td className={styles.tdRight}>{fmtNum(r.completionTokens)}</td>
              <td className={styles.tdRight}>
                <input
                  className={styles.priceInput}
                  type="number"
                  min="0"
                  step="0.01"
                  value={r.inputPrice || ''}
                  placeholder="0"
                  onChange={(e) => handleChange(r.key, 'input', e.target.value)}
                />
              </td>
              <td className={styles.tdRight}>
                <input
                  className={styles.priceInput}
                  type="number"
                  min="0"
                  step="0.01"
                  value={r.outputPrice || ''}
                  placeholder="0"
                  onChange={(e) => handleChange(r.key, 'output', e.target.value)}
                />
              </td>
              <td className={styles.tdRight}>{r.cost > 0 ? `$${r.cost.toFixed(4)}` : '—'}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td colSpan={6} className={styles.tfootLabel}>Grand total</td>
            <td className={`${styles.tdRight} ${styles.tfootTotal}`}>
              {grandTotal > 0 ? `$${grandTotal.toFixed(4)}` : '—'}
            </td>
          </tr>
        </tfoot>
      </table>
    </section>
  );
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatTime(t: number): string {
  if (!t || Number.isNaN(t)) return '—';
  const d = new Date(t);
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}

function levelClass(l: LogLevel): string {
  switch (l) {
    case 'info': return styles.levelInfo ?? '';
    case 'warn': return styles.levelWarn ?? '';
    case 'error': return styles.levelError ?? '';
    case 'fatal': return styles.levelFatal ?? '';
    default: return styles.levelDebug ?? '';
  }
}

function fmtNum(n: number): string {
  return n.toLocaleString();
}

function fmtBytes(b: number): string {
  if (b === 0) return '0 B';
  if (b < 1024) return `${b} B`;
  if (b < 1024 * 1024) return `${(b / 1024).toFixed(1)} KB`;
  if (b < 1024 * 1024 * 1024) return `${(b / (1024 * 1024)).toFixed(2)} MB`;
  return `${(b / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
