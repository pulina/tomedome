import { createContext, useContext, useState } from 'react';

interface InspectorContextValue {
  inspectedCallId: string | null;
  /** Bumps on every openInspector so tab can switch even when id is unchanged */
  inspectGeneration: number;
  openInspector: (id: string) => void;
  closeInspector: () => void;
}

export const InspectorContext = createContext<InspectorContextValue | null>(null);

export function useInspectorContextValue(): InspectorContextValue {
  const [inspectedCallId, setInspectedCallId] = useState<string | null>(null);
  const [inspectGeneration, setInspectGeneration] = useState(0);
  return {
    inspectedCallId,
    inspectGeneration,
    openInspector: (id) => {
      setInspectedCallId(id);
      setInspectGeneration((g) => g + 1);
    },
    closeInspector: () => setInspectedCallId(null),
  };
}

export function useInspector(): InspectorContextValue {
  const ctx = useContext(InspectorContext);
  if (!ctx) throw new Error('useInspector must be used inside InspectorContext.Provider');
  return ctx;
}
