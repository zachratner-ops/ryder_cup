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
  // Danger Zone: collapsed by default; destructive actions require typing a phrase
  const [showDanger, setShowDanger] = useState(false);
  const [resetConfirm, setResetConfirm] = useState('');
  const [seedConfirm, setSeedConfirm] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const u1 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    const u2 = onValue(ref(db, 'rounds'), (s) => setRounds(s.val() || {}));
    return () => { u1(); u2(); };
  }, []);

  const hasActiveRound = Object.values(rounds).some((r) => r.status === 'active');

  async function handleLogin(e) {
    e.preventDefault();
    // Verify PIN server-side — the PIN itself is not readable from the client.
    // The server treats any PIN as valid when no tournament exists yet (setup mode).
    try {
      const res = await fetch('/api/tournament/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin: pin }),
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        setAuthed(true);
      } else {
        setError('Wrong PIN');
      }
    } catch {
      setError('Could not reach server');
    }
  }

  async function handleSeed() {
    setBusy(true);
    try {
      const res = await fetch('/api/seed', { method: 'POST' });
      if (res.ok) {
        setSeedConfirm('');
        setPin('1234');
        setAuthed(true);
      } else {
        alert('Seed failed — is the server running?');
      }
    } finally {
      setBusy(false);
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
        </div>
      </div>
    );
  }

  async function handleReset() {
    setBusy(true);
    try {
      const res = await fetch('/api/tournament/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin: pin }),
      });
      if (res.ok) {
        setResetConfirm('');
        setAuthed(false);
        setPin('');
      } else {
        alert('Reset failed');
      }
    } finally {
      setBusy(false);
    }
  }

  // Reset requires typing the tournament name (or "RESET" before setup)
  const resetPhrase = tournament?.name?.trim() || 'RESET';
  const resetArmed = resetConfirm.trim().toLowerCase() === resetPhrase.toLowerCase();
  const seedArmed = seedConfirm.trim().toUpperCase() === 'SEED';

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

      {tournament?.name && (
        <>
          {hasActiveRound && (
            <div className={styles.activeRoundWarning}>
              ⚠️ Close active round before archiving
            </div>
          )}
          <button
            className={styles.archiveBtn}
            onClick={handleArchive}
            disabled={hasActiveRound}
          >
            📜 Archive &amp; Start New Tournament
          </button>
        </>
      )}

      {/* Danger Zone — collapsed by default; destructive actions need a typed phrase */}
      <button
        type="button"
        className={styles.dangerToggle}
        onClick={() => setShowDanger((v) => !v)}
      >
        {showDanger ? '▾' : '▸'} Danger Zone
      </button>

      {showDanger && (
        <div className={styles.dangerZone}>
          <p className={styles.dangerIntro}>
            These actions permanently erase data. They can't be undone.
          </p>

          {/* Reset */}
          <div className={styles.dangerItem}>
            <div className={styles.dangerItemTitle}>Reset tournament (no archive)</div>
            <p className={styles.dangerItemDesc}>
              Deletes everything without saving to History.{' '}
              {hasActiveRound
                ? 'Close the active round first.'
                : <>Type <strong>{resetPhrase}</strong> to confirm.</>}
            </p>
            {!hasActiveRound && (
              <input
                className={styles.dangerInput}
                value={resetConfirm}
                onChange={(e) => setResetConfirm(e.target.value)}
                placeholder={resetPhrase}
                autoCapitalize="none"
                autoCorrect="off"
              />
            )}
            <button
              className={styles.resetBtn}
              onClick={handleReset}
              disabled={hasActiveRound || !resetArmed || busy}
            >
              {busy ? 'Working…' : 'Reset Tournament'}
            </button>
          </div>

          {/* Seed */}
          <div className={styles.dangerItem}>
            <div className={styles.dangerItemTitle}>Load test data (seed)</div>
            <p className={styles.dangerItemDesc}>
              Replaces all data with a sample tournament (PIN 1234). For testing only.
              Type <strong>SEED</strong> to confirm.
            </p>
            <input
              className={styles.dangerInput}
              value={seedConfirm}
              onChange={(e) => setSeedConfirm(e.target.value)}
              placeholder="SEED"
              autoCapitalize="characters"
              autoCorrect="off"
            />
            <button
              className={styles.resetBtn}
              onClick={handleSeed}
              disabled={!seedArmed || busy}
            >
              {busy ? 'Working…' : '🌱 Load Test Data'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
