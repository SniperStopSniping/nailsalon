import styles from './StudioOpeningLoader.module.css';

export function StudioOpeningLoader() {
  return (
    <div className={styles.loader}>
      <div className={styles.content}>
        <span className={styles.wordmark}>Luster</span>
        <span>Opening your studio…</span>
      </div>
    </div>
  );
}
