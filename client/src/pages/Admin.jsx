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

  useEffect(() => {
    const u = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    return u;
  }, []);

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
      <div className={styles.page}>
        <h1 className={styles.title}>Admin</h1>
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
        {!tournament && (
          <p className={styles.hint}>No tournament set up yet — enter any PIN to begin setup.</p>
        )}
        <div className={styles.divider}>or</div>
        <button className={styles.seedBtn} onClick={handleSeed}>
          🌱 Seed test data
        </button>
      </div>
    );
  }

  async function handleReset() {
    if (!confirm('Reset tournament? This deletes ALL data and cannot be undone.')) return;
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

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Admin Panel</h1>
        <button className={styles.logout} onClick={() => setAuthed(false)}>Lock</button>
      </div>

      {!tournament?.name ? (
        <TournamentSetup />
      ) : (
        <RoundManager tournament={tournament} />
      )}

      <button className={styles.resetBtn} onClick={handleReset}>
        Reset Tournament
      </button>
    </div>
  );
}
