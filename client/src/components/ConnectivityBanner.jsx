import styles from './ConnectivityBanner.module.css';

// Fixed top banner that tells players when they're offline or have scores
// waiting to sync, so stale data doesn't read as "the app is broken".
export default function ConnectivityBanner({ online, pending, flushing }) {
  let mode = null;
  let text = '';

  if (!online) {
    mode = 'offline';
    text = pending > 0
      ? `Offline — ${pending} score${pending === 1 ? '' : 's'} will sync when you reconnect`
      : 'Offline — showing last-known scores';
  } else if (flushing && pending > 0) {
    mode = 'syncing';
    text = `Syncing ${pending} score${pending === 1 ? '' : 's'}…`;
  } else if (pending > 0) {
    mode = 'pending';
    text = `${pending} score${pending === 1 ? '' : 's'} waiting to sync…`;
  }

  if (!mode) return null;

  return (
    <div className={`${styles.banner} ${styles[mode]}`} role="status" aria-live="polite">
      <span className={styles.dot} />
      <span className={styles.text}>{text}</span>
    </div>
  );
}
