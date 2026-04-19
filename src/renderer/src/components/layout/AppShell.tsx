import { useState, useEffect, useRef } from 'react';
import { Outlet } from 'react-router-dom';
import { ThemeProvider } from '../ThemeProvider';
import { ChatsContext, useChatsContextValue } from '../../hooks/useChats';
import { SelectedSeriesContext, useSelectedSeriesContextValue } from '../../hooks/useSelectedSeries';
import { InspectorContext, useInspectorContextValue } from '../../hooks/useInspector';
import { Sidebar } from './Sidebar';
import { RightPanel } from './RightPanel';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

const MIN_PANEL_WIDTH = 150;
const MAX_PANEL_WIDTH = 600;

export function AppShell() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [sidebarWidth, setSidebarWidth] = useState(210);
  const [rightWidth, setRightWidth] = useState(234);
  const [dragging, setDragging] = useState<'sidebar' | 'right' | null>(null);
  const chatsValue = useChatsContextValue();
  const selectedSeriesValue = useSelectedSeriesContextValue();
  const inspectorValue = useInspectorContextValue();

  useEffect(() => {
    if (inspectorValue.inspectedCallId !== null) setRightOpen(true);
  }, [inspectorValue.inspectedCallId]);

  const dragRef = useRef<{
    panel: 'sidebar' | 'right';
    startX: number;
    startWidth: number;
  } | null>(null);

  const startDrag = (panel: 'sidebar' | 'right') => (e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = {
      panel,
      startX: e.clientX,
      startWidth: panel === 'sidebar' ? sidebarWidth : rightWidth,
    };
    setDragging(panel);
  };

  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      if (!dragRef.current) return;
      const { panel, startX, startWidth } = dragRef.current;
      const delta = e.clientX - startX;
      const newWidth = Math.max(
        MIN_PANEL_WIDTH,
        Math.min(MAX_PANEL_WIDTH, panel === 'sidebar' ? startWidth + delta : startWidth - delta),
      );
      if (panel === 'sidebar') setSidebarWidth(newWidth);
      else setRightWidth(newWidth);
    };

    const onMouseUp = () => {
      dragRef.current = null;
      setDragging(null);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, []);

  return (
    <InspectorContext.Provider value={inspectorValue}>
    <SelectedSeriesContext.Provider value={selectedSeriesValue}>
    <ChatsContext.Provider value={chatsValue}>
      <ThemeProvider>
        <div className={styles.app}>
          <div className={`${styles.layout} ${dragging ? styles.layoutDragging : ''}`}>
            <div
              className={`${styles.sidebarWrap} ${sidebarOpen ? '' : styles.sidebarWrapCollapsed}`}
              style={sidebarOpen ? {
                width: sidebarWidth,
                minWidth: sidebarWidth,
                transition: dragging === 'sidebar' ? 'none' : undefined,
              } : undefined}
            >
              <Sidebar />
            </div>
            {sidebarOpen && (
              <div
                className={`${styles.panelResizer} ${dragging === 'sidebar' ? styles.panelResizerActive : ''}`}
                style={{ left: sidebarWidth - 3 }}
                onMouseDown={startDrag('sidebar')}
              />
            )}
            <button
              className={`${styles.panelToggle} ${styles.sidebarToggle}`}
              style={{
                left: sidebarOpen ? sidebarWidth - 1 : 0,
                transition: dragging === 'sidebar' ? 'none' : undefined,
              }}
              onClick={() => setSidebarOpen((o) => !o)}
              title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              {sidebarOpen ? '‹' : '›'}
            </button>
            <div className={styles.main}>
              <TopBar sidebarOpen={sidebarOpen} />
              <div className={styles.content}>
                <Outlet />
              </div>
            </div>
            <button
              className={`${styles.panelToggle} ${styles.rightToggle}`}
              style={{
                right: rightOpen ? rightWidth - 1 : 0,
                transition: dragging === 'right' ? 'none' : undefined,
              }}
              onClick={() => setRightOpen((o) => { if (o) inspectorValue.closeInspector(); return !o; })}
              title={rightOpen ? 'Collapse panel' : 'Expand panel'}
            >
              {rightOpen ? '›' : '‹'}
            </button>
            {rightOpen && (
              <div
                className={`${styles.panelResizer} ${dragging === 'right' ? styles.panelResizerActive : ''}`}
                style={{ right: rightWidth - 3 }}
                onMouseDown={startDrag('right')}
              />
            )}
            <div
              className={`${styles.rightWrap} ${rightOpen ? '' : styles.rightWrapCollapsed}`}
              style={rightOpen ? {
                width: rightWidth,
                minWidth: rightWidth,
                transition: dragging === 'right' ? 'none' : undefined,
              } : undefined}
            >
              <RightPanel />
            </div>
          </div>
        </div>
      </ThemeProvider>
    </ChatsContext.Provider>
    </SelectedSeriesContext.Provider>
    </InspectorContext.Provider>
  );
}
