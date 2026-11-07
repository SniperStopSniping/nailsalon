import styles from './StudioOpeningLoader.module.css';

export function StudioOpeningLoader() {
  return (
    <div className={styles.loader}>
      <div className={styles.content}>
        <div className={styles.pearl}>
          <span className={styles.wordmark}>Luster</span>
        </div>
        <span>Opening your studio…</span>
        <div className={styles.dots} aria-hidden="true">
          <span />
          <span />
          <span />
        </div>
      </div>
    </div>
  );
}
