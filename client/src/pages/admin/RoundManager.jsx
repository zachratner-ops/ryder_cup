import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../../firebase';
import styles from './AdminForms.module.css';

const FORMATS = ['fourball', 'foursomes', 'singles', 'yellowball', 'scramble'];
const FORMAT_LABELS = { fourball: 'Four-ball', foursomes: 'Foursomes', singles: 'Singles', yellowball: 'Yellow Ball', scramble: 'Scramble' };
const FORMAT_ABBREV = { fourball: '4B', foursomes: 'FS', singles: '1v1', yellowball: 'YB', scramble: 'SCR' };

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

  // Yellow ball carrier order (4 slots per team, repeats across 18 holes)
  const [carrierOrderA, setCarrierOrderA] = useState(['', '', '', '']);
  const [carrierOrderB, setCarrierOrderB] = useState(['', '', '', '']);

  // Edit fields for a setup round
  const [editFormat, setEditFormat] = useState('fourball');
  const [editPoints, setEditPoints] = useState('1');
  const [editMatchCount, setEditMatchCount] = useState('2');
  const [editSegments, setEditSegments] = useState(false);
  const [editSegPts, setEditSegPts] = useState({ front: '1', back: '1', overall: '1' });
  const [editHoleCount, setEditHoleCount] = useState(18);

  // Add-round form
  const [showAdd, setShowAdd] = useState(false);
  const [addFormat, setAddFormat] = useState('fourball');
  const [addPoints, setAddPoints] = useState('1');
  const [addMatchCount, setAddMatchCount] = useState('2');
  const [addSegments, setAddSegments] = useState(false);
  const [addSegPts, setAddSegPts] = useState({ front: '1', back: '1', overall: '1' });
  const [addHoleCount, setAddHoleCount] = useState(18);

  function defaultMatchCount(format) {
    if (format === 'yellowball' || format === 'scramble') return 1;
    if (format === 'singles') return 4;
    return 2;
  }

  // Total points a round is worth, given its form state
  function totalPtsLabel(format, points, matchCount, segments, segPts) {
    const count = (format === 'yellowball' || format === 'scramble') ? 1 : (parseInt(matchCount) || 1);
    const perMatch = (format === 'fourball' && segments)
      ? (parseFloat(segPts.front) || 0) + (parseFloat(segPts.back) || 0) + (parseFloat(segPts.overall) || 0)
      : (parseFloat(points) || 1);
    return (perMatch * count).toFixed(1).replace(/\.0$/, '');
  }

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
      setEditMatchCount(String(round.matchCount ?? defaultMatchCount(round.format)));
      setEditSegments(!!round.segmentPoints);
      setEditSegPts(round.segmentPoints
        ? { front: String(round.segmentPoints.front ?? 1), back: String(round.segmentPoints.back ?? 1), overall: String(round.segmentPoints.overall ?? 1) }
        : { front: '1', back: '1', overall: '1' });
      setEditHoleCount(round.holeCount === 9 ? 9 : 18);
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

  function updatePairingSlot(pairingIdx, team, slotIdx, playerId) {
    setPairings((prev) => {
      const next = [...prev];
      const ids = [...(next[pairingIdx][team].playerIds || [])];
      ids[slotIdx] = playerId;
      next[pairingIdx] = { ...next[pairingIdx], [team]: { playerIds: ids } };
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
    // Strip any empty slot strings before sending
    const cleanedPairings = pairings.map(p => ({
      ...p,
      teamA: { playerIds: p.teamA.playerIds.filter(Boolean) },
      teamB: { playerIds: p.teamB.playerIds.filter(Boolean) },
    }));
    await call(`/api/rounds/${selectedRound}/start`, { matches: cleanedPairings }, 'Round started!');
    setPairings([]);
  }

  async function startYellowBall() {
    const allA = teamAPlayers.map(([id]) => id);
    const allB = teamBPlayers.map(([id]) => id);
    const matchId = `match_${Date.now()}`;
    const result = await call(`/api/rounds/${selectedRound}/start`, {
      matches: [{ matchId, teamA: { playerIds: allA }, teamB: { playerIds: allB } }],
      carrierOrder: { teamA: carrierOrderA, teamB: carrierOrderB },
    }, 'Yellow Ball round started!');
    return result;
  }

  async function startScramble() {
    const allA = teamAPlayers.map(([id]) => id);
    const allB = teamBPlayers.map(([id]) => id);
    const matchId = `match_${Date.now()}`;
    return call(`/api/rounds/${selectedRound}/start`, {
      matches: [{ matchId, teamA: { playerIds: allA }, teamB: { playerIds: allB } }],
    }, 'Scramble round started!');
  }

  function updateCarrierSlot(team, slot, playerId) {
    if (team === 'teamA') {
      setCarrierOrderA(prev => { const n = [...prev]; n[slot] = playerId; return n; });
    } else {
      setCarrierOrderB(prev => { const n = [...prev]; n[slot] = playerId; return n; });
    }
  }

  async function closeRound() {
    if (!confirm('Close this round and lock all scores?')) return;
    await call(`/api/rounds/${selectedRound}/close`, {}, 'Round closed and points tallied.');
  }

  async function saveRoundEdits() {
    const result = await call(`/api/rounds/${selectedRound}/update`, {
      format: editFormat,
      pointsValue: parseFloat(editPoints) || 1,
      matchCount: (editFormat === 'yellowball' || editFormat === 'scramble') ? 1 : (parseInt(editMatchCount) || defaultMatchCount(editFormat)),
      segmentPoints: (editFormat === 'fourball' && editSegments)
        ? { front: parseFloat(editSegPts.front) || 0, back: parseFloat(editSegPts.back) || 0, overall: parseFloat(editSegPts.overall) || 0 }
        : null,
      holeCount: editFormat === 'scramble' ? editHoleCount : null,
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
      matchCount: (addFormat === 'yellowball' || addFormat === 'scramble') ? 1 : (parseInt(addMatchCount) || defaultMatchCount(addFormat)),
      segmentPoints: (addFormat === 'fourball' && addSegments)
        ? { front: parseFloat(addSegPts.front) || 0, back: parseFloat(addSegPts.back) || 0, overall: parseFloat(addSegPts.overall) || 0 }
        : null,
      holeCount: addFormat === 'scramble' ? addHoleCount : null,
    }, 'Round added!');
    if (result?.roundId) {
      setSelectedRound(result.roundId);
      setShowAdd(false);
      setAddFormat('fourball');
      setAddPoints('1');
      setAddSegments(false);
      setAddSegPts({ front: '1', back: '1', overall: '1' });
      setAddHoleCount(18);
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
            className={`${styles.stepBtn} ${selectedRound === id ? styles.stepActive : ''} ${r.status === 'complete' ? styles.stepDone : ''}`}
            onClick={() => { setSelectedRound(id); setView('manage'); setMsg(''); setShowAdd(false); }}
          >
            <span>R{r.order} <span style={{ fontSize: 10, opacity: 0.75 }}>{FORMAT_ABBREV[r.format]}</span></span>
            {r.status === 'active' && <span className={styles.tabDot} />}
            {r.status === 'complete' && <span className={styles.tabCheck}>✓</span>}
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
              onChange={(e) => {
                setAddFormat(e.target.value);
                setAddMatchCount(String(defaultMatchCount(e.target.value)));
              }}
              className={styles.formatSelect}
            >
              {FORMATS.map((f) => <option key={f} value={f}>{FORMAT_LABELS[f]}</option>)}
            </select>
          </div>
          {addFormat === 'scramble' && (
            <div className={styles.roundRow}>
              <span className={styles.ptsLabel}>Holes:</span>
              {[9, 18].map(n => (
                <button
                  key={n}
                  type="button"
                  className={styles.stepBtn}
                  style={addHoleCount === n ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 700 } : {}}
                  onClick={() => setAddHoleCount(n)}
                >
                  {n}
                </button>
              ))}
            </div>
          )}
          {addFormat === 'fourball' && (
            <div className={styles.roundRow}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={addSegments}
                  onChange={(e) => setAddSegments(e.target.checked)}
                />
                Front 9 / Back 9 / Overall points
              </label>
            </div>
          )}
          {addFormat === 'fourball' && addSegments ? (
            <div className={styles.roundRow}>
              {['front', 'back', 'overall'].map(seg => (
                <span key={seg} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span className={styles.ptsLabel}>{seg === 'front' ? 'F9' : seg === 'back' ? 'B9' : '18'}</span>
                  <input
                    type="number" min="0" step="0.5"
                    value={addSegPts[seg]}
                    onChange={(e) => setAddSegPts(p => ({ ...p, [seg]: e.target.value }))}
                    className={styles.ptsInput}
                  />
                </span>
              ))}
              <span className={styles.ptsLabel}>
                = {totalPtsLabel(addFormat, addPoints, addMatchCount, true, addSegPts)} pts
              </span>
            </div>
          ) : (
            <div className={styles.roundRow}>
              <input
                type="number"
                min="0.5"
                step="0.5"
                value={addPoints}
                onChange={(e) => setAddPoints(e.target.value)}
                className={styles.ptsInput}
              />
              <span className={styles.ptsLabel}>pts/match ×</span>
              <input
                type="number"
                min="1"
                step="1"
                value={addMatchCount}
                disabled={addFormat === 'yellowball' || addFormat === 'scramble'}
                onChange={(e) => setAddMatchCount(e.target.value)}
                className={styles.ptsInput}
              />
              <span className={styles.ptsLabel}>
                = {totalPtsLabel(addFormat, addPoints, addMatchCount, false, addSegPts)} pts
              </span>
            </div>
          )}
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
        <div className={`${styles.section} ${round.status === 'active' ? styles.sectionActive : round.status === 'complete' ? styles.sectionDone : ''}`}>
          {/* Round header with edit toggle */}
          <div className={styles.roundMeta}>
            <div>
              <div className={styles.format}>{FORMAT_LABELS[round.format] || round.format}</div>
              <div className={styles.roundMetaSub}>
                <span className={styles.ptsChip}>
                  {round.segmentPoints
                    ? `F9 ${round.segmentPoints.front} · B9 ${round.segmentPoints.back} · 18 ${round.segmentPoints.overall} pts`
                    : `${round.matchCount ?? defaultMatchCount(round.format)} matches · ${round.pointsValue} pt${round.pointsValue !== 1 ? 's' : ''}/match`}
                  {round.format === 'scramble' ? ` · ${round.holeCount === 9 ? 9 : 18} holes` : ''}
                </span>
                <span className={`${styles.status} ${round.status === 'active' ? styles.live : ''}`}>{round.status}</span>
              </div>
            </div>
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

              {editFormat === 'scramble' && (
                <>
                  <label>Holes</label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {[9, 18].map(n => (
                      <button
                        key={n}
                        type="button"
                        className={styles.stepBtn}
                        style={editHoleCount === n ? { borderColor: 'var(--accent)', color: 'var(--accent)', fontWeight: 700 } : {}}
                        onClick={() => setEditHoleCount(n)}
                      >
                        {n} holes
                      </button>
                    ))}
                  </div>
                </>
              )}

              {editFormat === 'fourball' && (
                <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={editSegments}
                    onChange={(e) => setEditSegments(e.target.checked)}
                  />
                  Front 9 / Back 9 / Overall points
                </label>
              )}

              {editFormat === 'fourball' && editSegments ? (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                  {['front', 'back', 'overall'].map(seg => (
                    <span key={seg} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span className={styles.ptsLabel}>{seg === 'front' ? 'F9' : seg === 'back' ? 'B9' : '18'}</span>
                      <input
                        type="number" min="0" step="0.5"
                        value={editSegPts[seg]}
                        onChange={(e) => setEditSegPts(p => ({ ...p, [seg]: e.target.value }))}
                        className={styles.ptsInput}
                        style={{ width: '60px' }}
                      />
                    </span>
                  ))}
                </div>
              ) : (
                <>
                  <label>Pts per match</label>
                  <input
                    type="number"
                    min="0.5"
                    step="0.5"
                    value={editPoints}
                    onChange={(e) => setEditPoints(e.target.value)}
                    className={styles.ptsInput}
                    style={{ width: '100px' }}
                  />
                </>
              )}

              <label>Number of matches</label>
              <input
                type="number"
                min="1"
                step="1"
                value={editFormat === 'yellowball' || editFormat === 'scramble' ? 1 : editMatchCount}
                disabled={editFormat === 'yellowball' || editFormat === 'scramble'}
                onChange={(e) => setEditMatchCount(e.target.value)}
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

              {round.status === 'setup' && round.format === 'scramble' && (
                <>
                  <div className={styles.pairingsHeader}>⛳ Team Scramble</div>
                  <p className={styles.ybHint}>
                    Full-team scramble — everyone plays, one ball per team, no handicaps.
                    One team score per hole over {round.holeCount === 9 ? 9 : 18} holes; lowest total wins.
                  </p>
                  {[
                    { label: tournament.teamA?.name, color: 'var(--teamA)', teamPlayers: teamAPlayers },
                    { label: tournament.teamB?.name, color: 'var(--teamB)', teamPlayers: teamBPlayers },
                  ].map(({ label, color, teamPlayers }) => (
                    <div key={label} className={styles.pairingCard}>
                      <div className={styles.pairingTeam} style={{ color }}>{label}</div>
                      <div style={{ fontSize: 14, color: 'var(--text)', paddingTop: 4 }}>
                        {teamPlayers.map(([, p]) => p.name?.split(' ')[0]).join(' · ')}
                      </div>
                    </div>
                  ))}
                  <button className={styles.submitBtn} onClick={startScramble} disabled={busy}>
                    {busy ? 'Starting…' : 'Start Scramble Round'}
                  </button>
                </>
              )}

              {round.status === 'setup' && round.format !== 'yellowball' && round.format !== 'scramble' && (
                <>
                  <div className={styles.pairingsHeader}>Pairings</div>
                  {(() => {
                    const slotsPerTeam = round.format === 'singles' ? 1 : 2;
                    // Collect every selected player ID so we can hide them from other slots
                    const usedA = new Set(pairings.flatMap(p => p.teamA.playerIds).filter(Boolean));
                    const usedB = new Set(pairings.flatMap(p => p.teamB.playerIds).filter(Boolean));

                    return pairings.map((p, i) => (
                      <div key={i} className={styles.pairingCard}>
                        {[
                          { team: 'teamA', label: tournament.teamA?.name, color: 'var(--teamA)', pool: teamAPlayers, used: usedA, slots: p.teamA.playerIds },
                          { team: 'teamB', label: tournament.teamB?.name, color: 'var(--teamB)', pool: teamBPlayers, used: usedB, slots: p.teamB.playerIds },
                        ].map(({ team, label, color, pool, used, slots }) => (
                          <div key={team} className={styles.pairingRow}>
                            <span className={styles.pairingTeam} style={{ color }}>{label}</span>
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 6 }}>
                              {Array.from({ length: slotsPerTeam }, (_, slot) => {
                                const currentVal = slots[slot] || '';
                                return (
                                  <select
                                    key={slot}
                                    value={currentVal}
                                    onChange={e => updatePairingSlot(i, team, slot, e.target.value)}
                                    className={styles.playerSelect}
                                  >
                                    <option value="">— pick player —</option>
                                    {pool
                                      .filter(([id]) => !used.has(id) || id === currentVal)
                                      .map(([id, pl]) => <option key={id} value={id}>{pl.name}</option>)}
                                  </select>
                                );
                              })}
                            </div>
                          </div>
                        ))}
                      </div>
                    ));
                  })()}
                  <button className={styles.addRound} onClick={addPairing}>+ Add pairing</button>
                  <button className={styles.submitBtn} onClick={startRound} disabled={busy || !pairings.length}>
                    {busy ? 'Starting…' : 'Start Round'}
                  </button>
                </>
              )}

              {round.status === 'setup' && round.format === 'yellowball' && (
                <>
                  <div className={styles.pairingsHeader}>🟡 Carrier Rotation</div>
                  <p className={styles.ybHint}>Set the order each team's players carry the yellow ball. Repeats across all 18 holes.</p>

                  {[
                    { team: 'teamA', label: tournament.teamA?.name, color: 'var(--teamA)', players: teamAPlayers, order: carrierOrderA },
                    { team: 'teamB', label: tournament.teamB?.name, color: 'var(--teamB)', players: teamBPlayers, order: carrierOrderB },
                  ].map(({ team, label, color, players: teamPlayers, order }) => (
                    <div key={team} className={styles.pairingCard}>
                      <div className={styles.pairingTeam} style={{ color }}>{label}</div>
                      {[0, 1, 2, 3].map(slot => (
                        <div key={slot} className={styles.carrierSlotRow}>
                          <span className={styles.carrierSlotNum}>Slot {slot + 1}</span>
                          <select
                            value={order[slot] || ''}
                            onChange={e => updateCarrierSlot(team, slot, e.target.value)}
                            className={styles.carrierSlotSelect}
                          >
                            <option value="">— pick player —</option>
                            {teamPlayers.map(([id, pl]) => <option key={id} value={id}>{pl.name}</option>)}
                          </select>
                        </div>
                      ))}
                    </div>
                  ))}

                  <button
                    className={styles.submitBtn}
                    onClick={startYellowBall}
                    disabled={busy || carrierOrderA.some(v => !v) || carrierOrderB.some(v => !v)}
                  >
                    {busy ? 'Starting…' : 'Start Yellow Ball Round'}
                  </button>
                </>
              )}

              {round.status === 'active' && (
                <>
                  <div className={styles.pairingsHeader}>Active Matches</div>
                  {roundMatches.map(([mid, m]) => (
                    <div key={mid} className={styles.activeMatch}>
                      <span style={{ color: 'var(--teamA)', fontWeight: 600 }}>{m.teamA?.playerIds?.map((id) => players[id]?.name?.split(' ')[0]).join(' & ')}</span>
                      <span className={styles.vs}>vs</span>
                      <span style={{ color: 'var(--teamB)', fontWeight: 600 }}>{m.teamB?.playerIds?.map((id) => players[id]?.name?.split(' ')[0]).join(' & ')}</span>
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
