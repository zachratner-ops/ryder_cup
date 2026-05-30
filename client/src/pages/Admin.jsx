import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import styles from './Admin.module.css';
import TournamentSetup from './admin/TournamentSetup';
import RoundManager from './admin/RoundManager';

export default function Admin() {
  const [pin, setPin] = useState('');
  const [authed, setAuthed] = useState(false);
  const [error, setError] = useState('');
  const [tournament, setTournament] = useState(null);
  const [rounds, setRounds] = useState({});

  useEffect(() => {
    const u1 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    const u2 = onValue(ref(db, 'rounds'), (s) => setRounds(s.val() || {}));
    return () => { u1(); u2(); };
  }, []);

  const hasActiveRound = Object.values(rounds).some((r) => r.status === 'active');

  async function handleLogin(e) {
    e.preventDefault();
    // Verify PIN against Firebase
    const snap = await new Promise((resolve) =>
      onValue(ref(db, 'tournament/adminPin'), resolve, { onlyOnce: true })
    );
    const storedPin = snap.val();
    if (!storedPin) {
      // No tournament yet — allow any PIN to enter setup
      setAuthed(true);
      return;
    }
    if (pin === storedPin) {
      setAuthed(true);
    } else {
      setError('Wrong PIN');
    }
  }

  async function handleSeed() {
    if (!confirm('Seed test data? This replaces all existing data with a sample tournament (PIN: 1234).')) return;
    const res = await fetch('/api/seed', { method: 'POST' });
    if (res.ok) {
      setPin('1234');
      setAuthed(true);
    } else {
      alert('Seed failed — is the server running?');
    }
  }

  if (!authed) {
    return (
      <div className={styles.pinPage}>
        <div className={styles.pinBox}>
          <div className={styles.pinIcon}>🔒</div>
          <h1 className={styles.title}>Admin</h1>
          {!tournament && (
            <p className={styles.hint}>No tournament yet — enter any PIN to begin setup.</p>
          )}
          <form onSubmit={handleLogin} className={styles.loginForm}>
            <input
              type="password"
              inputMode="numeric"
              placeholder="Enter PIN"
              value={pin}
              onChange={(e) => { setPin(e.target.value); setError(''); }}
              className={styles.pinInput}
              autoFocus
            />
            {error && <div className={styles.error}>{error}</div>}
            <button type="submit" className={styles.loginBtn}>Enter</button>
          </form>
          <div className={styles.divider}>or</div>
          <button className={styles.seedBtn} onClick={handleSeed}>
            🌱 Seed test data
          </button>
        </div>
      </div>
    );
  }

  async function handleReset() {
    if (!confirm('Reset tournament? This deletes all data and cannot be undone.')) return;
    const res = await fetch('/api/tournament/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin: pin }),
    });
    if (res.ok) {
      setAuthed(false);
      setPin('');
    } else {
      alert('Reset failed');
    }
  }

  async function handleArchive() {
    if (!confirm('Archive this tournament and start fresh?\n\nResults will be saved to History, then all current data will be wiped.')) return;
    const res = await fetch('/api/archive', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ adminPin: pin, reset: true }),
    });
    if (res.ok) {
      alert('Tournament archived! You can view it in the History tab.');
      setAuthed(false);
      setPin('');
    } else {
      const body = await res.json().catch(() => ({}));
      alert('Archive failed: ' + (body.error || res.status));
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <button className={styles.logout} onClick={() => setAuthed(false)}>Lock</button>
      </div>

      {!tournament?.name ? (
        <TournamentSetup />
      ) : (
        <RoundManager tournament={tournament} adminPin={pin} />
      )}

      {hasActiveRound && (
        <div className={styles.activeRoundWarning}>
          ⚠️ Close active round before resetting
        </div>
      )}

      <button
        className={styles.archiveBtn}
        onClick={handleArchive}
        disabled={hasActiveRound}
      >
        📜 Archive &amp; Start New Tournament
      </button>

      <button
        className={styles.resetBtn}
        onClick={handleReset}
        disabled={hasActiveRound}
      >
        Reset Tournament (no archive)
      </button>
    </div>
  );
}
