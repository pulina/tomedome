import { ReactNode } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { LlmStatusContext, useLlmStatus, useLlmStatusContextValue } from '../hooks/useLlmStatus';

interface Props {
  children: ReactNode;
}

export function LlmGate({ children }: Props) {
  const value = useLlmStatusContextValue();
  return (
    <LlmStatusContext.Provider value={value}>
      <LlmGateInner>{children}</LlmGateInner>
    </LlmStatusContext.Provider>
  );
}

function LlmGateInner({ children }: Props) {
  const { configured } = useLlmStatus();
  const { pathname } = useLocation();

  if (configured === null) return null; // loading

  if (!configured && pathname !== '/settings') {
    return <Navigate to="/settings" replace />;
  }

  return <>{children}</>;
}
