import logoSmallUrl from '../../assets/logo_small.svg';
import styles from './TopBar.module.css';

export function TopBar({ sidebarOpen }: { sidebarOpen: boolean }) {
  return (
    <header className={styles.topbar}>
      {!sidebarOpen && (
        <img src={logoSmallUrl} alt="TomeDome" className={styles.logo} />
      )}
    </header>
  );
}
