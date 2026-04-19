import { useEffect, useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import type { Chat } from '@shared/types';
import { chatApi } from '../../api/chat-api';
import { useChats } from '../../hooks/useChats';
import { useSelectedSeries } from '../../hooks/useSelectedSeries';
import logoUrl from '../../assets/logo.svg';
import styles from './Sidebar.module.css';

const NAV_ITEMS = [
  { to: '/chat', icon: '⌘', label: 'Chat' },
  { to: '/library', icon: '◫', label: 'Library' },
  { to: '/settings', icon: '⚙', label: 'Settings' },
  { to: '/stats', icon: '◈', label: 'Stats & Logs' },
  { to: '/about', icon: '◉', label: 'About' },
];

export function Sidebar() {
  const { chats, refresh, upsert, remove } = useChats();
  const { series, selectedSeriesId, setSelectedSeriesId } = useSelectedSeries();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [menuOpenFor, setMenuOpenFor] = useState<string | null>(null);

  // Close popover on outside click or escape. We mark menu-related elements
  // with `data-chat-menu` so the handler can distinguish inside vs outside.
  useEffect(() => {
    if (!menuOpenFor) return;
    const onDoc = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target || !target.closest('[data-chat-menu]')) setMenuOpenFor(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpenFor(null);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpenFor]);

  async function handleNewChat() {
    if (creating) return;
    setCreating(true);
    try {
      const chat = await chatApi.create();
      upsert(chat);
      navigate(`/chat/${chat.id}`);
    } finally {
      setCreating(false);
    }
  }

  async function handleDelete(id: string) {
    setMenuOpenFor(null);
    remove(id);
    try {
      await chatApi.remove(id);
    } catch {
      // Refresh to restore if deletion failed server-side.
      await refresh();
    }
    navigate('/chat');
  }

  return (
    <aside className={styles.sidebar}>
      <div className={styles.logoArea}>
        <img src={logoUrl} alt="TomeDome" className={styles.logoIcon} />
      </div>

      <select
        className={styles.selector}
        value={selectedSeriesId ?? ''}
        onChange={(e) => setSelectedSeriesId(e.target.value || null)}
      >
        <option value="">All series</option>
        {series.map((s) => (
          <option key={s.id} value={s.id}>{s.title}</option>
        ))}
      </select>

      <button
        className={styles.newChat}
        type="button"
        onClick={handleNewChat}
        disabled={creating}
      >
        {creating ? '⊚ Creating…' : '⊕ New Inquiry'}
      </button>

      <div className={styles.sectionLabel}>Inquiries</div>
      <div className={styles.threadList}>
        {chats.length === 0 ? (
          <div className={styles.empty}>No inquiries yet.</div>
        ) : (
          chats.map((chat) => (
            <ChatItem
              key={chat.id}
              chat={chat}
              menuOpen={menuOpenFor === chat.id}
              openMenu={() => setMenuOpenFor(chat.id)}
              onDelete={() => handleDelete(chat.id)}
            />
          ))
        )}
      </div>

      <nav className={styles.nav}>
        {NAV_ITEMS.map(({ to, icon, label }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/chat'}
            className={({ isActive }) =>
              isActive ? `${styles.navItem} ${styles.navItemActive}` : styles.navItem
            }
          >
            <span className={styles.navIcon}>{icon}</span>
            {label}
          </NavLink>
        ))}
      </nav>
    </aside>
  );
}

interface ChatItemProps {
  chat: Chat;
  menuOpen: boolean;
  openMenu: () => void;
  onDelete: () => void;
}

function ChatItem({ chat, menuOpen, openMenu, onDelete }: ChatItemProps) {
  const isUnknown = chat.titleStatus === 'pending' && chat.title === 'Unknown';
  return (
    <div style={{ position: 'relative' }}>
      <NavLink
        to={`/chat/${chat.id}`}
        className={({ isActive }) =>
          isActive ? `${styles.threadItem} ${styles.threadItemActive}` : styles.threadItem
        }
        title={chat.title}
      >
        <span className={styles.threadDot} />
        <span
          className={`${styles.threadTitle} ${isUnknown ? styles.threadTitleUnknown : ''}`}
        >
          {isUnknown ? 'Unknown' : chat.title}
        </span>
        <button
          type="button"
          className={styles.threadMenu}
          data-chat-menu
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            openMenu();
          }}
          aria-label="Chat options"
        >
          ⋯
        </button>
      </NavLink>
      {menuOpen && (
        <div className={styles.popover} data-chat-menu>
          <button type="button" className={styles.popoverItem} onClick={onDelete}>
            Delete
          </button>
        </div>
      )}
    </div>
  );
}
