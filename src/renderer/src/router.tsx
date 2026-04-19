import { createHashRouter, Navigate } from 'react-router-dom';
import { AppShell } from './components/layout/AppShell';
import { LlmGate } from './components/LlmGate';
import { ChatPage } from './pages/ChatPage';
import { LibraryPage } from './pages/LibraryPage';
import { StatsLogsPage } from './pages/StatsLogsPage';
import { AboutPage } from './pages/AboutPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { SettingsPage } from './components/settings/SettingsPage';

export const router = createHashRouter([
  {
    path: '/',
    element: (
      <LlmGate>
        <AppShell />
      </LlmGate>
    ),
    children: [
      { index: true, element: <Navigate to="/chat" replace /> },
      { path: 'chat', element: <ChatPage /> },
      { path: 'chat/:chatId', element: <ChatPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'settings', element: <SettingsPage /> },
      { path: 'stats', element: <StatsLogsPage /> },
      { path: 'about', element: <AboutPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);
