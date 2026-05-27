import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../firebase';
import styles from './AdminForms.module.css';

export default function RoundManager({ tournament }) {
  const [rounds, setRounds] = useState({});
  const [players, setPlayers] = useState({});
  const [matches, setMatches] = useState({});
  const [selectedRound, setSelectedRound] = useState(null);
  const [pairings, setPairings] = useState([]);
  const [adminPin, setAdminPin] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const u1 = onValue(ref(db, 'rounds'), (s) => {
      const r = s.val() || {};
      setRounds(r);
      // Auto-select first non-complete round
      const active = Object.entries(r).find(([, v]) => v.status !== 'complete');
      if (active && !selectedRound) setSelectedRound(active[0]);
    });
    const u2 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u3 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    return () => { u1(); u2(); u3(); };
  }, []);

  const roundList = Object.entries(rounds).sort(([, a], [, b]) => a.order - b.order);
  const round = selectedRound ? rounds[selectedRound] : null;
  const roundMatches = Object.entries(matches).filter(([, m]) => m.roundId === selectedRound);

  const teamAPlayers = Object.entries(players).filter(([, p]) => p.teamId === 'teamA');
  const teamBPlayers = Object.entries(players).filter(([, p]) => p.teamId === 'teamB');

  function addPairing() {
    setPairings((p) => [...p, { matchId: `match_${Date.now()}`, teamA: { playerIds: [] }, teamB: { playerIds: [] } }]);
  }

  function updatePairing(i, team, playerIds) {
    setPairings((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [team]: { playerIds } };
      return next;
    });
  }

  async function startRound() {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/rounds/${selectedRound}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin, matches: pairings }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg('Round started!');
      setPairings([]);
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  async function closeRound() {
    if (!confirm('Close this round and lock all scores?')) return;
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(`/api/rounds/${selectedRound}/close`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg('Round closed and points tallied.');
    } catch (err) {
      setMsg(`Error: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.form}>
      <div className={styles.steps}>
        {roundList.map(([id, r]) => (
          <button
            key={id}
            className={`${styles.stepBtn} ${selectedRound === id ? styles.stepActive : ''}`}
            onClick={() => setSelectedRound(id)}
          >
            R{r.order}
          </button>
        ))}
      </div>

      {round && (
        <div className={styles.section}>
          <div className={styles.roundMeta}>
            <span className={styles.format}>{round.format}</span>
            <span className={`${styles.status} ${round.status === 'active' ? styles.live : ''}`}>{round.status}</span>
          </div>

          <label>Admin PIN</label>
          <input
            type="password"
            inputMode="numeric"
            value={adminPin}
            onChange={(e) => setAdminPin(e.target.value)}
            placeholder="PIN"
            className={styles.pinSmall}
          />

          {round.status === 'setup' && (
            <>
              <div className={styles.pairingsHeader}>Pairings</div>
              {pairings.map((p, i) => (
                <div key={i} className={styles.pairingCard}>
                  <div className={styles.pairingRow}>
                    <span className={styles.pairingTeam} style={{ color: 'var(--teamA)' }}>{tournament.teamA?.name}</span>
                    <select multiple size={2} value={p.teamA.playerIds} onChange={(e) => updatePairing(i, 'teamA', Array.from(e.target.selectedOptions, (o) => o.value))} className={styles.playerSelect}>
                      {teamAPlayers.map(([id, pl]) => <option key={id} value={id}>{pl.name}</option>)}
                    </select>
                  </div>
                  <div className={styles.pairingRow}>
                    <span className={styles.pairingTeam} style={{ color: 'var(--teamB)' }}>{tournament.teamB?.name}</span>
                    <select multiple size={2} value={p.teamB.playerIds} onChange={(e) => updatePairing(i, 'teamB', Array.from(e.target.selectedOptions, (o) => o.value))} className={styles.playerSelect}>
                      {teamBPlayers.map(([id, pl]) => <option key={id} value={id}>{pl.name}</option>)}
                    </select>
                  </div>
                </div>
              ))}
              <button className={styles.addRound} onClick={addPairing}>+ Add pairing</button>
              <button className={styles.submitBtn} onClick={startRound} disabled={busy || !pairings.length}>
                {busy ? 'Starting…' : 'Start Round'}
              </button>
            </>
          )}

          {round.status === 'active' && (
            <>
              <div className={styles.pairingsHeader}>Active Matches</div>
              {roundMatches.map(([mid, m]) => (
                <div key={mid} className={styles.activeMatch}>
                  <span>{m.teamA?.playerIds?.map((id) => players[id]?.name).join(' & ')}</span>
                  <span className={styles.vs}>vs</span>
                  <span>{m.teamB?.playerIds?.map((id) => players[id]?.name).join(' & ')}</span>
                </div>
              ))}
              <button className={styles.closeBtn} onClick={closeRound} disabled={busy}>
                {busy ? 'Closing…' : 'Close Round'}
              </button>
            </>
          )}

          {round.status === 'complete' && (
            <div className={styles.complete}>Round complete</div>
          )}

          {msg && <div className={styles.msg}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
