import { Link } from 'react-router-dom';
import styles from './NotFoundPage.module.css';

export function NotFoundPage() {
  return (
    <div className={styles.wrap}>
      <h1 className={styles.title}>Page not found</h1>
      <p className={styles.hint}>This route does not exist in TomeDome.</p>
      <Link className={styles.link} to="/chat">
        Back to chat
      </Link>
    </div>
  );
}
