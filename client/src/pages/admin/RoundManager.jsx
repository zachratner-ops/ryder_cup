import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../firebase';
import styles from './AdminForms.module.css';

const FORMATS = ['fourball', 'foursomes', 'singles', 'yellowball'];
const FORMAT_LABELS = { fourball: 'Four-ball', foursomes: 'Foursomes', singles: 'Singles', yellowball: 'Yellow Ball' };

export default function RoundManager({ tournament, adminPin: propPin }) {
  const [rounds, setRounds] = useState({});
  const [players, setPlayers] = useState({});
  const [matches, setMatches] = useState({});
  const [selectedRound, setSelectedRound] = useState(null);
  const [pairings, setPairings] = useState([]);
  const [adminPin, setAdminPin] = useState(propPin || '');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');

  // "edit" view = round settings; "manage" = pairings/start/close
  const [view, setView] = useState('manage'); // 'manage' | 'edit'

  // Edit fields for a setup round
  const [editFormat, setEditFormat] = useState('fourball');
  const [editPoints, setEditPoints] = useState('1');

  // Add-round form
  const [showAdd, setShowAdd] = useState(false);
  const [addFormat, setAddFormat] = useState('fourball');
  const [addPoints, setAddPoints] = useState('1');

  useEffect(() => {
    const u1 = onValue(ref(db, 'rounds'), (s) => {
      const r = s.val() || {};
      setRounds(r);
      if (!selectedRound) {
        const active = Object.entries(r).find(([, v]) => v.status !== 'complete');
        if (active) setSelectedRound(active[0]);
      }
    });
    const u2 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u3 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    return () => { u1(); u2(); u3(); };
  }, []);

  // Keep adminPin in sync if prop changes (e.g. parent re-renders)
  useEffect(() => {
    if (propPin) setAdminPin(propPin);
  }, [propPin]);

  // Sync edit fields when round selection changes
  useEffect(() => {
    const round = selectedRound ? rounds[selectedRound] : null;
    if (round) {
      setEditFormat(round.format || 'fourball');
      setEditPoints(String(round.pointsValue ?? 1));
    }
  }, [selectedRound, rounds]);

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

  async function call(url, body, successMsg) {
    setBusy(true);
    setMsg('');
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminPin, ...body }),
      });
      if (!res.ok) throw new Error(await res.text());
      setMsg(successMsg || 'Done!');
      return await res.json();
    } catch (err) {
      setMsg(`Error: ${err.message}`);
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function startRound() {
    await call(`/api/rounds/${selectedRound}/start`, { matches: pairings }, 'Round started!');
    setPairings([]);
  }

  async function closeRound() {
    if (!confirm('Close this round and lock all scores?')) return;
    await call(`/api/rounds/${selectedRound}/close`, {}, 'Round closed and points tallied.');
  }

  async function saveRoundEdits() {
    const result = await call(`/api/rounds/${selectedRound}/update`, {
      format: editFormat,
      pointsValue: parseFloat(editPoints) || 1,
    }, 'Round updated.');
    if (result) setView('manage');
  }

  async function deleteRound() {
    if (!confirm(`Delete Round ${round.order}? This cannot be undone.`)) return;
    const result = await call(`/api/rounds/${selectedRound}/delete`, {}, 'Round deleted.');
    if (result) {
      setSelectedRound(null);
      setView('manage');
    }
  }

  async function addRound() {
    const result = await call('/api/rounds/add', {
      format: addFormat,
      pointsValue: parseFloat(addPoints) || 1,
    }, 'Round added!');
    if (result?.roundId) {
      setSelectedRound(result.roundId);
      setShowAdd(false);
      setAddFormat('fourball');
      setAddPoints('1');
      setView('manage');
    }
  }

  return (
    <div className={styles.form}>
      {/* Round selector tabs */}
      <div className={styles.steps}>
        {roundList.map(([id, r]) => (
          <button
            key={id}
            className={`${styles.stepBtn} ${selectedRound === id ? styles.stepActive : ''}`}
            onClick={() => { setSelectedRound(id); setView('manage'); setMsg(''); setShowAdd(false); }}
          >
            R{r.order}
          </button>
        ))}
        <button
          className={`${styles.stepBtn} ${showAdd ? styles.stepActive : ''}`}
          onClick={() => { setShowAdd((v) => !v); setSelectedRound(null); setMsg(''); }}
        >
          + Add
        </button>
      </div>

      {/* Add-round form */}
      {showAdd && (
        <div className={styles.section}>
          <div className={styles.pairingsHeader}>New Round</div>
          <div className={styles.roundRow}>
            <select
              value={addFormat}
              onChange={(e) => setAddFormat(e.target.value)}
              className={styles.formatSelect}
            >
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </select>
            <input
              type="number"
              min="0.5"
              step="0.5"
              value={addPoints}
              onChange={(e) => setAddPoints(e.target.value)}
              className={styles.ptsInput}
            />
            <span className={styles.ptsLabel}>pts</span>
          </div>
          {!propPin && (
            <>
              <label>Admin PIN</label>
              <input
                type="password"
                inputMode="numeric"
                value={adminPin}
                onChange={(e) => setAdminPin(e.target.value)}
                placeholder="PIN"
                className={styles.pinSmall}
              />
            </>
          )}
          <button className={styles.submitBtn} onClick={addRound} disabled={busy}>
            {busy ? 'Adding…' : 'Add Round'}
          </button>
          {msg && <div className={styles.msg}>{msg}</div>}
        </div>
      )}

      {/* Selected round panel */}
      {round && !showAdd && (
        <div className={styles.section}>
          {/* Round header with edit toggle */}
          <div className={styles.roundMeta}>
            <span className={styles.format}>{FORMAT_LABELS[round.format] || round.format}</span>
            <span className={styles.ptsChip}>{round.pointsValue} pt{round.pointsValue !== 1 ? 's' : ''}</span>
            <span className={`${styles.status} ${round.status === 'active' ? styles.live : ''}`}>{round.status}</span>
            {round.status === 'setup' && (
              <button
                className={styles.editToggle}
                onClick={() => setView((v) => v === 'edit' ? 'manage' : 'edit')}
              >
                {view === 'edit' ? '✕ Cancel' : '✎ Edit'}
              </button>
            )}
          </div>

          {/* Edit round settings (setup only) */}
          {view === 'edit' && round.status === 'setup' && (
            <>
              <label>Format</label>
              <select
                value={editFormat}
                onChange={(e) => setEditFormat(e.target.value)}
              >
                {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
              </select>

              <label>Points value</label>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={editPoints}
                onChange={(e) => setEditPoints(e.target.value)}
                className={styles.ptsInput}
                style={{ width: '100px' }}
              />

              {!propPin && (
                <>
                  <label>Admin PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    placeholder="PIN"
                    className={styles.pinSmall}
                  />
                </>
              )}

              <button className={styles.submitBtn} onClick={saveRoundEdits} disabled={busy}>
                {busy ? 'Saving…' : 'Save Changes'}
              </button>
              <button className={styles.deleteBtn} onClick={deleteRound} disabled={busy}>
                Delete Round
              </button>
            </>
          )}

          {/* Manage view (pairings / active matches / complete) */}
          {view === 'manage' && (
            <>
              {!propPin && (
                <>
                  <label>Admin PIN</label>
                  <input
                    type="password"
                    inputMode="numeric"
                    value={adminPin}
                    onChange={(e) => setAdminPin(e.target.value)}
                    placeholder="PIN"
                    className={styles.pinSmall}
                  />
                </>
              )}

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
                <div className={styles.complete}>Round complete ✓</div>
              )}
            </>
          )}

          {msg && <div className={styles.msg}>{msg}</div>}
        </div>
      )}
    </div>
  );
}
