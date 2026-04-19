import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { Series } from '@shared/types';
import { seriesApi } from '../api/series-api';

interface SelectedSeriesContextValue {
  series: Series[];
  selectedSeriesId: string | null; // null = show all
  setSelectedSeriesId: (id: string | null) => void;
  refresh: () => Promise<void>;
}

export const SelectedSeriesContext = createContext<SelectedSeriesContextValue | null>(null);

const STORAGE_KEY = 'selectedSeriesId';

export function useSelectedSeriesContextValue(): SelectedSeriesContextValue {
  const [series, setSeries] = useState<Series[]>([]);
  const [selectedSeriesId, setSelectedSeriesIdRaw] = useState<string | null>(
    () => localStorage.getItem(STORAGE_KEY) ?? null,
  );

  const setSelectedSeriesId = useCallback((id: string | null) => {
    setSelectedSeriesIdRaw(id);
    if (id === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, id);
  }, []);

  const refresh = useCallback(async () => {
    try {
      const list = await seriesApi.list();
      setSeries(list);
      setSelectedSeriesIdRaw((current) => {
        if (current !== null && !list.some((s) => s.id === current)) {
          localStorage.removeItem(STORAGE_KEY);
          return null;
        }
        return current;
      });
    } catch {
      // swallow — sidebar shows empty state while backend boots
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { series, selectedSeriesId, setSelectedSeriesId, refresh };
}

export function useSelectedSeries(): SelectedSeriesContextValue {
  const ctx = useContext(SelectedSeriesContext);
  if (!ctx) throw new Error('useSelectedSeries must be used inside SelectedSeriesContext.Provider');
  return ctx;
}
