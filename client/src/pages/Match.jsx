import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, set, update, push } from 'firebase/database';
import { db } from '../firebase';
import TeamLogo from '../components/TeamLogo';
import styles from './Match.module.css';
import {
  computeNassauStatus,
  computeSegmentStatus,
  computePressPayout,
  canPress,
  formatSegmentStatus,
} from '../nassauCompute';

// ── helpers shared by MatchBetsTab ──────────────────────────────────────────

function betFirstName(players, id) {
  return players[id]?.name?.split(' ')[0] || id;
}

function betTeamColor(players, id) {
  return players[id]?.teamId === 'teamA' ? 'var(--teamA)' : 'var(--teamB)';
}

function SEG_LABEL(seg) {
  return seg === 'front' ? 'Front 9' : seg === 'back' ? 'Back 9' : 'Overall';
}

/** First unplayed hole within [startHole, endHole] for both playerA and playerB */
function nextPressStartHole(holeData, playerA, playerB, startHole, endHole) {
  for (let h = startHole; h <= endHole; h++) {
    const grossA = holeData?.[h]?.[playerA]?.gross;
    const grossB = holeData?.[h]?.[playerB]?.gross;
    if (grossA == null || grossB == null) return h;
  }
  return endHole + 1; // all played, no room to press
}

// ── MatchBetsTab component ───────────────────────────────────────────────────

function MatchBetsTab({ matchId, holeData, players, nassauBets, customBets, allPlayerIds, playerId, isAdmin }) {
  const [presses, setPresses] = useState({});
  const [confirmPress, setConfirmPress] = useState(null); // { nassauBetId, segment, pressId?, startHole, endHole, amount }
  const [showCreate, setShowCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Nassau create form (pre-filled to this match)
  const [newOpponent, setNewOpponent] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [newCompFront, setNewCompFront] = useState(true);
  const [newCompBack, setNewCompBack] = useState(true);
  const [newCompOverall, setNewCompOverall] = useState(true);
  const [newCompCustom, setNewCompCustom] = useState(false);
  const [newCustomStart, setNewCustomStart] = useState('');
  const [newCustomEnd, setNewCustomEnd] = useState('');

  // Custom create form
  const [createTab, setCreateTab] = useState('nassau');
  const [customDesc, setCustomDesc] = useState('');
  const [customPlayerIds, setCustomPlayerIds] = useState(playerId ? [playerId] : []);
  const [customAmount, setCustomAmount] = useState('');

  // Inline settle state
  const [settlingBetId, setSettlingBetId] = useState(null);
  const [settleWinners, setSettleWinners] = useState([]);

  function toggleCustomPlayer(id) {
    setCustomPlayerIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  // Backward-compat helpers
  function getBetPlayerIds(bet) {
    if (Array.isArray(bet.players)) return bet.players;
    return [bet.playerA, bet.playerB].filter(Boolean);
  }

  function getBetWinnerIds(bet) {
    if (bet.status !== 'settled') return null;
    if (Array.isArray(bet.winners)) return bet.winners;
    const all = getBetPlayerIds(bet);
    if (bet.winner === 'half') return all;
    if (bet.winner) return [bet.winner];
    return null;
  }

  useEffect(() => {
    const u = onValue(ref(db, 'presses'), (s) => setPresses(s.val() || {}));
    return u;
  }, []);

  // Nassau bets tied to this match
  const matchNassauBets = useMemo(() =>
    Object.entries(nassauBets).filter(([, b]) => b.matchId === matchId),
    [nassauBets, matchId]
  );

  // Custom bets explicitly created within this match
  const matchCustomBets = useMemo(() =>
    Object.entries(customBets).filter(([, b]) => b.matchId === matchId),
    [customBets, matchId]
  );

  const betCount = matchNassauBets.length + matchCustomBets.length;

  async function handleCreateNassau() {
    const myId = isAdmin ? null : playerId;
    if (!myId && !isAdmin) { setCreateError('Select your player first.'); return; }
    if (!newOpponent || !newAmount) { setCreateError('Fill in all fields.'); return; }
    if (newOpponent === myId) { setCreateError('Pick a different opponent.'); return; }

    const components = [];
    if (newCompFront) components.push({ label: 'Front 9', startHole: 1, endHole: 9 });
    if (newCompBack) components.push({ label: 'Back 9', startHole: 10, endHole: 18 });
    if (newCompOverall) components.push({ label: 'Overall', startHole: 1, endHole: 18 });
    if (newCompCustom) {
      const s = parseInt(newCustomStart), e = parseInt(newCustomEnd);
      if (!s || !e || s < 1 || e > 18 || s >= e) {
        setCreateError('Custom range: enter valid holes (1–18, start < end).');
        return;
      }
      components.push({ label: `Holes ${s}–${e}`, startHole: s, endHole: e });
    }
    if (components.length === 0) { setCreateError('Select at least one component.'); return; }

    setCreateLoading(true);
    setCreateError('');
    try {
      const res = await fetch('/api/bets/nassau', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId,
          playerA: myId || allPlayerIds[0],
          playerB: newOpponent,
          amount: parseFloat(newAmount),
          components,
          createdBy: myId || 'admin',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed');
      setShowCreate(false);
      setNewOpponent('');
      setNewAmount('');
      setNewCompFront(true); setNewCompBack(true); setNewCompOverall(true);
      setNewCompCustom(false); setNewCustomStart(''); setNewCustomEnd('');
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleCreateCustom() {
    if (!customDesc.trim() || !customAmount) {
      setCreateError('Fill in all fields.');
      return;
    }
    if (customPlayerIds.length < 2) {
      setCreateError('Select at least two players.');
      return;
    }
    setCreateLoading(true);
    setCreateError('');
    try {
      await push(ref(db, 'customBets'), {
        description: customDesc.trim(),
        players: customPlayerIds,
        amount: parseFloat(customAmount),
        winners: null,
        matchId,                          // tie this bet to the match it was created in
        createdBy: playerId || 'unknown',
        createdAt: Date.now(),
        status: 'open',
        settledBy: null,
        settledAt: null,
      });
      setShowCreate(false);
      setCustomDesc('');
      setCustomPlayerIds(playerId ? [playerId] : []);
      setCustomAmount('');
    } catch (e) {
      setCreateError(e.message);
    } finally {
      setCreateLoading(false);
    }
  }

  function startSettle(betId) {
    setSettlingBetId(betId);
    setSettleWinners([]);
  }

  async function confirmSettle() {
    if (!settlingBetId || !settleWinners.length) return;
    const bet = customBets[settlingBetId];
    if (!bet) return;
    const allPlayers = getBetPlayerIds(bet);
    const allTied = settleWinners.length === allPlayers.length;
    try {
      await update(ref(db, `customBets/${settlingBetId}`), {
        winners: settleWinners,
        winner: allTied ? 'half' : settleWinners[0],
        status: 'settled',
        settledBy: playerId || 'unknown',
        settledAt: Date.now(),
      });
    } catch (e) {
      console.error(e);
    }
    setSettlingBetId(null);
    setSettleWinners([]);
  }

  async function handlePress(cfg) {
    // cfg: { nassauBetId, startHole, endHole, parentPressId, segment }
    try {
      await push(ref(db, 'presses'), {
        nassauBetId: cfg.nassauBetId,
        parentPressId: cfg.parentPressId || null,
        segment: cfg.segment || null,
        startHole: cfg.startHole,
        endHole: cfg.endHole,
        presserPlayerId: playerId || 'unknown',
        status: 'active',
        createdAt: Date.now(),
      });
    } catch (e) {
      console.error('Press failed:', e);
    }
    setConfirmPress(null);
  }

  // Render a press button for a segment (or a press-of-press)
  function renderPressButton(nassauBet, betId, segStatus, startHole, endHole, segment, parentPressId) {
    if (!playerId) return null; // spectator can't press
    const isPlayerA = nassauBet.playerA === playerId;
    const isPlayerB = nassauBet.playerB === playerId;
    if (!isPlayerA && !isPlayerB) return null;

    if (!canPress(segStatus, isPlayerA, startHole, endHole)) return null;

    const pressStart = nextPressStartHole(holeData, nassauBet.playerA, nassauBet.playerB, startHole, endHole);
    if (pressStart > endHole) return null;

    // Hide button once a press already exists for this context.
    // For segment-level presses: match on nassauBetId + segment label.
    // For press-of-press: match on nassauBetId + parentPressId.
    const existingPress = Object.values(presses).find(p => {
      if (p.nassauBetId !== betId) return false;
      if (parentPressId) {
        // sub-press: is there already a child of this parent?
        return p.parentPressId === parentPressId;
      } else {
        // segment-level: is there already a press for this segment?
        return p.parentPressId == null && p.segment === segment;
      }
    });
    if (existingPress) return null;

    const cfg = { nassauBetId: betId, startHole: pressStart, endHole, segment, parentPressId: parentPressId || null };

    return (
      <button
        className={parentPressId ? styles.pressPressBtn : styles.nassauPressBtn}
        onClick={() => setConfirmPress(cfg)}
      >
        Press
      </button>
    );
  }

  // Recursively render press rows (and their sub-presses)
  function renderPressRows(nassauBet, betId, parentPressId) {
    const childPresses = Object.entries(presses).filter(([, p]) =>
      p.nassauBetId === betId && p.parentPressId === (parentPressId || null) && p.parentPressId !== null
    );
    // For segment-level presses (parentPressId = null), they're rendered by renderNassauSegments
    if (childPresses.length === 0) return null;
    return (
      <div className={styles.pressRows}>
        {childPresses.map(([pressId, press]) => {
          const segStatus = computeSegmentStatus(holeData, nassauBet, press.startHole, press.endHole);
          const nameA = betFirstName(players, nassauBet.playerA);
          const nameB = betFirstName(players, nassauBet.playerB);
          const statusStr = formatSegmentStatus(segStatus, nameA, nameB, press.startHole, press.endHole);
          return (
            <div key={pressId}>
              <div className={styles.pressRow}>
                <span className={styles.pressLabel}>Press {press.startHole}–{press.endHole}</span>
                <span className={styles.pressStatus}>{statusStr}</span>
                {renderPressButton(nassauBet, betId, segStatus, press.startHole, press.endHole, null, pressId)}
              </div>
              {renderPressRows(nassauBet, betId, pressId)}
            </div>
          );
        })}
      </div>
    );
  }

  function renderNassauCard([betId, bet]) {
    const componentStatuses = computeNassauStatus(holeData, bet);
    const nameA = betFirstName(players, bet.playerA);
    const nameB = betFirstName(players, bet.playerB);

    return (
      <div key={betId} className={styles.nassauCard}>
        <div className={styles.nassauCardHeader}>
          <div className={styles.nassauPlayers}>
            <span style={{ color: betTeamColor(players, bet.playerA) }}>{nameA}</span>
            <span className={styles.nassauVs}>vs</span>
            <span style={{ color: betTeamColor(players, bet.playerB) }}>{nameB}</span>
          </div>
          <div className={styles.nassauMeta}>${bet.amount}/comp</div>
        </div>

        <div className={styles.nassauSegments}>
          {componentStatuses.map(({ label, startHole, endHole, status: s }) => {
            const statusStr = formatSegmentStatus(s, nameA, nameB, startHole, endHole);
            const decided = s.winner !== 'incomplete';

            // Segment-level presses keyed by label
            const segPresses = Object.entries(presses).filter(([, p]) =>
              p.nassauBetId === betId && p.segment === label && p.parentPressId == null
            );

            return (
              <div key={label}>
                <div className={styles.nassauSegRow}>
                  <span className={styles.nassauSegLabel}>{label}</span>
                  <span className={`${styles.nassauSegStatus} ${
                    decided && s.winner !== 'half' ? styles.nassauSegStatusWon :
                    s.holesPlayed === 0 ? styles.nassauSegStatusMuted : ''
                  }`}>
                    {statusStr}
                  </span>
                  {!decided && renderPressButton(bet, betId, s, startHole, endHole, label, null)}
                </div>

                {/* Segment-level presses */}
                {segPresses.length > 0 && (
                  <div className={styles.pressRows}>
                    {segPresses.map(([pressId, press]) => {
                      const pressStatus = computeSegmentStatus(holeData, bet, press.startHole, press.endHole);
                      const pressStatusStr = formatSegmentStatus(pressStatus, nameA, nameB, press.startHole, press.endHole);
                      return (
                        <div key={pressId}>
                          <div className={styles.pressRow}>
                            <span className={styles.pressLabel}>Press {press.startHole}–{press.endHole}</span>
                            <span className={styles.pressStatus}>{pressStatusStr}</span>
                            {!pressStatus.decided && renderPressButton(bet, betId, pressStatus, press.startHole, press.endHole, null, pressId)}
                          </div>
                          {renderPressRows(bet, betId, pressId)}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  const matchPlayerOptions = allPlayerIds.filter(id => id !== (isAdmin ? null : playerId));

  return (
    <div className={styles.betsTab}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div className={styles.sectionLabel} style={{ marginBottom: 0 }}>Bets in this match</div>
        {(isAdmin || (playerId && allPlayerIds.includes(playerId))) && (
          <button className={styles.addBetBtn} onClick={() => { setShowCreate(true); setCreateError(''); }}>+ Add Bet</button>
        )}
      </div>

      {betCount === 0 && !showCreate && (
        <div className={styles.betsTabEmpty}>
          {(isAdmin || (playerId && allPlayerIds.includes(playerId)))
            ? 'No bets yet — tap Add Bet to start one'
            : 'No bets yet'}
        </div>
      )}

      {/* Nassau bets */}
      {matchNassauBets.map(renderNassauCard)}

      {/* Custom bets */}
      {matchCustomBets.map(([betId, bet]) => {
        const betPids = getBetPlayerIds(bet);
        const winnerIds = getBetWinnerIds(bet);
        const allTied = winnerIds && winnerIds.length === betPids.length;
        const settledLabel = winnerIds
          ? allTied ? 'Halved' : winnerIds.map(pid => betFirstName(players, pid)).join(' & ') + ' wins'
          : null;
        const isSettling = settlingBetId === betId;

        return (
          <div key={betId} className={styles.customBetCard}>
            <div className={styles.customBetHeader}>
              <span className={styles.customBetDesc}>{bet.description}</span>
              <span className={styles.customBetAmount}>${bet.amount}</span>
            </div>
            <div className={styles.customBetFooter}>
              <span className={styles.customBetPlayers}>
                {betPids.map((pid, i) => (
                  <span key={pid}>
                    {i > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
                    <span style={{ color: betTeamColor(players, pid), fontWeight: 700 }}>{betFirstName(players, pid)}</span>
                  </span>
                ))}
              </span>
              {bet.status === 'settled' ? (
                <span className={styles.betStatusSettled}>{settledLabel}</span>
              ) : (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span className={styles.betStatusOpen}>Open</span>
                  <button className={styles.betSettleBtn} onClick={() => startSettle(betId)}>Settle</button>
                </div>
              )}
            </div>
            {/* Inline settle panel */}
            {isSettling && (
              <div style={{ marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
                <div style={{ fontSize: 12, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 8 }}>
                  Who won?
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                  {betPids.map(pid => {
                    const on = settleWinners.includes(pid);
                    return (
                      <button
                        key={pid}
                        type="button"
                        style={{
                          padding: '6px 14px', borderRadius: 20,
                          border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                          background: on ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                        onClick={() => setSettleWinners(prev =>
                          prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
                        )}
                      >
                        {betFirstName(players, pid)}
                      </button>
                    );
                  })}
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    style={{ flex: 1, background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 700, cursor: 'pointer', opacity: settleWinners.length ? 1 : 0.4 }}
                    onClick={confirmSettle}
                    disabled={!settleWinners.length}
                  >
                    Confirm
                  </button>
                  <button
                    style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px', fontSize: 14, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer' }}
                    onClick={() => setSettlingBetId(null)}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>
        );
      })}

      {/* Press confirm overlay */}
      {confirmPress && (
        <div className={styles.pressConfirm}>
          <span className={styles.pressConfirmText}>
            Press holes {confirmPress.startHole}–{confirmPress.endHole} · ${nassauBets[confirmPress.nassauBetId]?.amount}?
          </span>
          <div className={styles.pressConfirmBtns}>
            <button className={styles.pressConfirmYes} onClick={() => handlePress(confirmPress)}>Yes</button>
            <button className={styles.pressConfirmNo} onClick={() => setConfirmPress(null)}>No</button>
          </div>
        </div>
      )}

      {/* Create bet sheet */}
      {showCreate && (
        <div style={{ marginTop: 16 }}>
          <div className={styles.ybTabs} style={{ marginBottom: 14 }}>
            <button
              className={`${styles.ybTabBtn} ${createTab === 'nassau' ? styles.ybTabActive : ''}`}
              style={createTab === 'nassau' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
              onClick={() => { setCreateTab('nassau'); setCreateError(''); }}
            >
              Nassau
            </button>
            <button
              className={`${styles.ybTabBtn} ${createTab === 'custom' ? styles.ybTabActive : ''}`}
              style={createTab === 'custom' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
              onClick={() => { setCreateTab('custom'); setCreateError(''); }}
            >
              Custom
            </button>
          </div>

          {createTab === 'nassau' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div className={styles.sectionLabel}>Opponent</div>
                <select
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 14px', fontSize: 15, width: '100%', color: 'var(--text)' }}
                  value={newOpponent}
                  onChange={(e) => setNewOpponent(e.target.value)}
                >
                  <option value="">Select opponent…</option>
                  {matchPlayerOptions.filter(id => id !== playerId).map(id => (
                    <option key={id} value={id}>{players[id]?.name || id}</option>
                  ))}
                </select>
              </div>
              <div>
                <div className={styles.sectionLabel}>Components</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {[
                    { label: 'Front 9', val: newCompFront, set: setNewCompFront },
                    { label: 'Back 9', val: newCompBack, set: setNewCompBack },
                    { label: 'Overall', val: newCompOverall, set: setNewCompOverall },
                    { label: 'Custom', val: newCompCustom, set: setNewCompCustom },
                  ].map(({ label, val, set }) => (
                    <button
                      key={label}
                      type="button"
                      style={{
                        padding: '7px 14px', borderRadius: 20,
                        border: `1.5px solid ${val ? 'var(--accent)' : 'var(--border)'}`,
                        background: val ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                        color: val ? 'var(--accent)' : 'var(--text-muted)',
                        fontSize: 13, fontWeight: 600, cursor: 'pointer',
                      }}
                      onClick={() => set(v => !v)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                {newCompCustom && (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 8 }}>
                    <input
                      style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--text)' }}
                      type="number" min="1" max="17" placeholder="Start hole"
                      value={newCustomStart} onChange={e => setNewCustomStart(e.target.value)}
                    />
                    <span style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0 4px' }}>–</span>
                    <input
                      style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 14, color: 'var(--text)' }}
                      type="number" min="2" max="18" placeholder="End hole"
                      value={newCustomEnd} onChange={e => setNewCustomEnd(e.target.value)}
                    />
                  </div>
                )}
              </div>
              <div>
                <div className={styles.sectionLabel}>$ Per Component</div>
                <input
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 14px', fontSize: 15, width: '100%', color: 'var(--text)', boxSizing: 'border-box' }}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 5"
                  value={newAmount}
                  onChange={(e) => setNewAmount(e.target.value)}
                />
              </div>
              {createError && <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{createError}</p>}
              <button
                style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 12, padding: 15, fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: createLoading ? 0.5 : 1 }}
                onClick={handleCreateNassau}
                disabled={createLoading}
              >
                {createLoading ? 'Creating…' : 'Create Nassau Bet'}
              </button>
            </div>
          )}

          {createTab === 'custom' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div className={styles.sectionLabel}>Description</div>
                <input
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 14px', fontSize: 15, width: '100%', color: 'var(--text)', boxSizing: 'border-box' }}
                  type="text"
                  placeholder="e.g. First birdie of the day"
                  value={customDesc}
                  onChange={(e) => setCustomDesc(e.target.value)}
                />
              </div>
              <div>
                <div className={styles.sectionLabel}>Players (select all involved)</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allPlayerIds.map(id => {
                    const on = customPlayerIds.includes(id);
                    return (
                      <button
                        key={id}
                        type="button"
                        style={{
                          padding: '7px 14px', borderRadius: 20,
                          border: `1.5px solid ${on ? 'var(--accent)' : 'var(--border)'}`,
                          background: on ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                          color: on ? 'var(--accent)' : 'var(--text-muted)',
                          fontSize: 13, fontWeight: 600, cursor: 'pointer',
                        }}
                        onClick={() => toggleCustomPlayer(id)}
                      >
                        {players[id]?.name?.split(' ')[0] || id}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className={styles.sectionLabel}>$ Amount (per person)</div>
                <input
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 14px', fontSize: 15, width: '100%', color: 'var(--text)', boxSizing: 'border-box' }}
                  type="number"
                  min="0"
                  step="1"
                  placeholder="e.g. 10"
                  value={customAmount}
                  onChange={(e) => setCustomAmount(e.target.value)}
                />
              </div>
              {createError && <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{createError}</p>}
              <button
                style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 12, padding: 15, fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: createLoading ? 0.5 : 1 }}
                onClick={handleCreateCustom}
                disabled={createLoading}
              >
                {createLoading ? 'Creating…' : 'Create Custom Bet'}
              </button>
            </div>
          )}

          <button
            style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 15, fontWeight: 600, width: '100%', padding: 12, cursor: 'pointer', marginTop: 4 }}
            onClick={() => { setShowCreate(false); setCreateError(''); }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

// ── Main match computations ──────────────────────────────────────────────────

function computeMatchStatus(holeResults, teamAIds, teamBIds) {
  let diff = 0;
  let holesPlayed = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = holeResults?.[h];
    if (!hole?.holeWinner) continue;
    holesPlayed++;
    if (hole.holeWinner === 'teamA') diff++;
    else if (hole.holeWinner === 'teamB') diff--;
    // Detect match decided: leading margin exceeds holes remaining
    const margin = Math.abs(diff);
    const remaining = 18 - holesPlayed;
    if (margin > remaining) return `${margin}&${remaining}`;
  }
  if (holesPlayed === 0) return 'All Square';
  if (diff === 0) return `All Square thru ${holesPlayed}`;
  const margin = Math.abs(diff);
  return `${margin}UP thru ${holesPlayed}`;
}

export default function Match({ playerId, isAdmin }) {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [round, setRound] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [holeData, setHoleData] = useState({});
  const [players, setPlayers] = useState({});
  const [courseHoles, setCourseHoles] = useState({});
  const [currentHole, setCurrentHole] = useState(1);
  // Admin: which player's score is currently being entered
  const [entryForId, setEntryForId] = useState(null);
  // Yellow ball scorecard tab: 'teamA' | 'teamB' | 'score'
  const [ybTab, setYbTab] = useState(null); // null = derive from player's team
  // Page-level tab: 'scorecard' | 'bets'
  const [matchTab, setMatchTab] = useState('scorecard');
  // Side bets data
  const [nassauBets, setNassauBets] = useState({});
  const [customBets, setCustomBets] = useState({});
  const [entry, setEntry] = useState({ gross: '', fairwayHit: null, gir: false, putts: '' });
  const [justSaved, setJustSaved] = useState(false);
  const initialJumped = useRef(false);

  useEffect(() => {
    const u1 = onValue(ref(db, `matches/${matchId}`), (s) => setMatch(s.val()));
    const u2 = onValue(ref(db, `holes/${matchId}`), (s) => setHoleData(s.val() || {}));
    const u3 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u4 = onValue(ref(db, 'course/holes'), (s) => setCourseHoles(s.val() || {}));
    const u5 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [matchId]);

  // Load round data (needed for yellow ball carrier order)
  useEffect(() => {
    if (!match?.roundId) return;
    const u = onValue(ref(db, `rounds/${match.roundId}`), (s) => setRound(s.val()));
    return u;
  }, [match?.roundId]);

  // Subscribe to bets when on Bets tab, unsubscribe when leaving
  useEffect(() => {
    if (matchTab !== 'bets') return;
    const u1 = onValue(ref(db, 'nassauBets'), (s) => setNassauBets(s.val() || {}));
    const u2 = onValue(ref(db, 'customBets'), (s) => setCustomBets(s.val() || {}));
    return () => { u1(); u2(); };
  }, [matchTab]);

  // Auto-advance to first unplayed hole on initial load
  useEffect(() => {
    if (initialJumped.current || Object.keys(holeData).length === 0) return;
    const firstUnplayed = Array.from({ length: 18 }, (_, i) => i + 1)
      .find(h => !holeData[h]?.holeWinner);
    if (firstUnplayed) setCurrentHole(firstUnplayed);
    initialJumped.current = true;
  }, [holeData]);

  // Admin: initialise entryForId to first player (or 'teamA' for foursomes)
  useEffect(() => {
    if (!isAdmin || entryForId || !match) return;
    if (match.format === 'foursomes') {
      setEntryForId('teamA');
    } else {
      const first = match.teamA?.playerIds?.[0] || match.teamB?.playerIds?.[0];
      if (first) setEntryForId(first);
    }
  }, [isAdmin, match, entryForId]);

  // Default gross to par when hole changes (non-admin path)
  useEffect(() => {
    if (isAdmin) return; // admin uses its own pre-fill effect below
    const par = courseHoles[currentHole]?.par;
    if (!par) return;
    setEntry({ gross: par, fairwayHit: null, gir: false, putts: '' });
  }, [currentHole, courseHoles, isAdmin]);

  // Admin: pre-fill from the selected player's existing score when player or hole changes
  useEffect(() => {
    if (!isAdmin || !entryForId) return;
    const existing = holeData[currentHole]?.[entryForId];
    const par = courseHoles[currentHole]?.par;
    if (existing?.gross) {
      setEntry({
        gross: existing.gross,
        fairwayHit: existing.fairwayHit ?? null,
        gir: existing.gir ?? false,
        putts: existing.putts ?? '',
      });
    } else {
      setEntry({ gross: par || '', fairwayHit: null, gir: false, putts: '' });
    }
    // holeData intentionally omitted: we don't want live score updates resetting the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, entryForId, currentHole, courseHoles]);

  if (!match) return <div className={styles.loading}>Loading match…</div>;

  const allPlayerIds = [...(match.teamA?.playerIds || []), ...(match.teamB?.playerIds || [])];

  // Derive default YB tab from player's team; spectators/admin default to 'score'
  const activeYbTab = ybTab ?? (
    match.teamA?.playerIds?.includes(playerId) ? 'teamA'
    : match.teamB?.playerIds?.includes(playerId) ? 'teamB'
    : 'score'
  );

  // Format flags (must come first — used in variable derivations below)
  const isYellowBall = match.format === 'yellowball';
  const isFoursomes = match.format === 'foursomes';

  // For foursomes, derive team from playerId directly to avoid circular dependency
  const playerTeam = match.teamA?.playerIds?.includes(playerId) ? 'teamA'
    : match.teamB?.playerIds?.includes(playerId) ? 'teamB'
    : 'teamA';

  // The player/pair whose score we're currently entering:
  // • normal mode  → the logged-in player (or playerTeam for foursomes)
  // • admin mode   → whichever player/pair admin has selected
  // For foursomes, effectivePlayerId is 'teamA' or 'teamB' (pair key, not a player ID)
  const effectivePlayerId = isFoursomes
    ? (isAdmin ? (entryForId || 'teamA') : playerTeam)
    : (isAdmin ? (entryForId || null) : playerId);

  // myTeam: for foursomes effectivePlayerId is already 'teamA'/'teamB';
  // for other formats derive from which team holds the effectivePlayerId
  const myTeam = isFoursomes
    ? effectivePlayerId
    : (effectivePlayerId && match.teamA?.playerIds?.includes(effectivePlayerId) ? 'teamA'
      : effectivePlayerId && match.teamB?.playerIds?.includes(effectivePlayerId) ? 'teamB'
      : 'teamA');

  // Per-hole running match status for the non-YB scorecard column
  const scorecardStatus = (() => {
    if (isYellowBall) return {};
    const result = {};
    let diff = 0, decided = false, decidedText = '', decidedTeam = null;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (!hd?.holeWinner) break;
      if (decided) { result[h] = { text: decidedText, team: decidedTeam }; continue; }
      if (hd.holeWinner === 'teamA') diff++;
      else if (hd.holeWinner === 'teamB') diff--;
      const remaining = 18 - h;
      const margin = Math.abs(diff);
      const team = diff > 0 ? 'teamA' : diff < 0 ? 'teamB' : null;
      if (diff === 0) {
        result[h] = { text: 'AS', team: null };
      } else if (margin > remaining) {
        decidedText = `${margin}&${remaining}`;
        decidedTeam = team;
        decided = true;
        result[h] = { text: decidedText, team };
      } else {
        result[h] = { text: `${margin} up`, team };
      }
    }
    return result;
  })();
  const carrierOrder = match.carrierOrder || round?.carrierOrder;
  function getCarrier(holeNum, team) {
    const order = carrierOrder?.[team];
    if (!order?.length) return null;
    return order[(holeNum - 1) % order.length];
  }
  const ybCarrierA = isYellowBall ? getCarrier(currentHole, 'teamA') : null;
  const ybCarrierB = isYellowBall ? getCarrier(currentHole, 'teamB') : null;
  const myYBCarrier = isYellowBall && effectivePlayerId
    ? getCarrier(currentHole, myTeam) === effectivePlayerId
    : false;

  const myAllocation = match.strokeAllocation?.[effectivePlayerId]?.holes || [];
  const hole = courseHoles[currentHole] || {};
  const isPar3 = hole.par === 3;
  const receiveStroke = myAllocation.includes(currentHole);
  const gross = parseInt(entry.gross) || 0;
  const net = isYellowBall
    ? (gross > 0 ? gross : null)
    : gross > 0 ? gross - (receiveStroke ? 1 : 0) : null;

  const grossVsPar = gross > 0 && hole.par ? gross - hole.par : null;
  const stepperAnnotation = grossVsPar == null ? ''
    : grossVsPar <= -2 ? styles.scoreEagle
    : grossVsPar === -1 ? styles.scoreBirdie
    : grossVsPar === 1 ? styles.scoreBogey
    : grossVsPar >= 2 ? styles.scoreDouble
    : '';

  // Admin can always enter scores; regular players only when in the match
  const isMyMatch = isAdmin ? !!effectivePlayerId : allPlayerIds.includes(playerId);
  const roundComplete = match.status === 'complete';

  const myHoleScore = holeData[currentHole]?.[effectivePlayerId];
  const iSubmitted = !!myHoleScore?.gross;
  const holeComplete = !!holeData[currentHole]?.holeWinner;
  const waitingOn = (() => {
    if (!iSubmitted || holeComplete) return [];
    if (isFoursomes) {
      const opponentPair = myTeam === 'teamA' ? 'teamB' : 'teamA';
      return holeData[currentHole]?.[opponentPair]?.gross ? [] : ['__pair__'];
    }
    if (isYellowBall) {
      return [ybCarrierA, ybCarrierB].filter(id => id && id !== effectivePlayerId && !holeData[currentHole]?.[id]?.gross);
    }
    return allPlayerIds.filter(id => id !== effectivePlayerId && !holeData[currentHole]?.[id]?.gross);
  })();

  // Compute match result info when match is decided or complete
  const resultInfo = (() => {
    if (isYellowBall) {
      let cumA = 0, cumB = 0, holesPlayed = 0;
      for (let h = 1; h <= 18; h++) {
        if (holeData[h]?.ybNetA == null) break;
        cumA += holeData[h].ybNetA; cumB += holeData[h].ybNetB; holesPlayed++;
      }
      if (holesPlayed < 18 && match.status !== 'complete') return null;
      if (holesPlayed === 0) return null;
      const diff = cumA - cumB;
      const winner = diff < 0 ? 'teamA' : diff > 0 ? 'teamB' : null;
      return { winner, text: diff === 0 ? 'Tied — Halved' : `by ${Math.abs(diff)} stroke${Math.abs(diff) !== 1 ? 's' : ''}` };
    }
    let diff = 0, holesPlayed = 0, decided = null;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (!hd?.holeWinner) break;
      holesPlayed++;
      if (hd.holeWinner === 'teamA') diff++;
      else if (hd.holeWinner === 'teamB') diff--;
      const margin = Math.abs(diff), remaining = 18 - holesPlayed;
      if (!decided && (margin > remaining || holesPlayed === 18)) {
        decided = { margin, remaining, diff };
      }
    }
    if (!decided) return null;
    const { margin, remaining, diff: fd } = decided;
    const winner = fd > 0 ? 'teamA' : fd < 0 ? 'teamB' : null;
    const text = fd === 0 ? 'All Square — Halved' : (remaining === 0 ? `${margin} UP` : `${margin}&${remaining}`);
    return { winner, text };
  })();

  async function submitHole() {
    if (!gross || !effectivePlayerId) return;
    const holeRef = ref(db, `holes/${matchId}/${currentHole}/${effectivePlayerId}`);
    await set(holeRef, {
      gross,
      net,
      fairwayHit: isPar3 ? null : entry.fairwayHit,
      gir: entry.gir,
      putts: entry.putts !== '' ? parseInt(entry.putts) : null,
    });

    await computeAndWriteHoleWinner(currentHole);

    setJustSaved(true);
    setTimeout(() => {
      setJustSaved(false);
      // Admin stays on the same hole so they can move to the next player
      if (!isAdmin && currentHole < 18) setCurrentHole(h => h + 1);
    }, 900);
  }

  async function computeAndWriteHoleWinner(holeNum) {
    const snap = await new Promise((resolve) =>
      onValue(ref(db, `holes/${matchId}/${holeNum}`), resolve, { onlyOnce: true })
    );
    const scores = snap.val() || {};

    const teamAIds = match.teamA?.playerIds || [];
    const teamBIds = match.teamB?.playerIds || [];
    const holeRef = ref(db, `holes/${matchId}/${holeNum}`);

    if (isFoursomes) {
      const scoreA = scores.teamA;
      const scoreB = scores.teamB;
      if (scoreA?.net == null || scoreB?.net == null) return;
      const winner = scoreA.net < scoreB.net ? 'teamA' : scoreA.net > scoreB.net ? 'teamB' : 'half';
      const status = computeMatchStatus({ ...holeData, [holeNum]: { holeWinner: winner } }, [], []);
      await update(holeRef, { holeWinner: winner, matchStatus: status });
      return;
    }

    if (isYellowBall) {
      const carrierAId = getCarrier(holeNum, 'teamA');
      const carrierBId = getCarrier(holeNum, 'teamB');
      const ybNetA = scores[carrierAId]?.net;
      const ybNetB = scores[carrierBId]?.net;
      if (ybNetA == null || ybNetB == null) return;
      const winner = ybNetA < ybNetB ? 'teamA' : ybNetA > ybNetB ? 'teamB' : 'half';
      await update(holeRef, { holeWinner: winner, ybNetA, ybNetB });
      return;
    }

    const teamANets = teamAIds.map((id) => scores[id]?.net).filter((n) => n != null);
    const teamBNets = teamBIds.map((id) => scores[id]?.net).filter((n) => n != null);
    if (teamANets.length < teamAIds.length || teamBNets.length < teamBIds.length) return;

    const bestA = Math.min(...teamANets);
    const bestB = Math.min(...teamBNets);
    const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';
    const status = computeMatchStatus(
      { ...holeData, [holeNum]: { holeWinner: winner } },
      teamAIds,
      teamBIds
    );
    await update(holeRef, { holeWinner: winner, matchStatus: status });
  }

  const matchStatus = (() => {
    if (isYellowBall) {
      let cumA = 0, cumB = 0, holesPlayed = 0;
      for (let h = 1; h <= 18; h++) {
        const hd = holeData[h];
        if (hd?.ybNetA == null || hd?.ybNetB == null) break;
        cumA += hd.ybNetA;
        cumB += hd.ybNetB;
        holesPlayed++;
      }
      if (holesPlayed === 0) return '🟡 Yellow Ball';
      const diff = cumA - cumB;
      if (diff === 0) return `🟡 Tied thru ${holesPlayed}`;
      const margin = Math.abs(diff);
      const leadTeam = diff < 0 ? 'teamA' : 'teamB';
      const leadName = tournament?.[leadTeam]?.name ?? leadTeam;
      return `🟡 ${leadName} leads by ${margin} thru ${holesPlayed}`;
    }
    return computeMatchStatus(holeData, match.teamA?.playerIds, match.teamB?.playerIds);
  })();

  // ─── Yellow ball scorecard ─────────────────────────────────────────────────
  // Three tabs: NW team grid | NE team grid | cumulative score view

  function ybScoreShape(grs, par) {
    if (!grs || !par) return '';
    const d = grs - par;
    if (d <= -2) return styles.scoreEagle;
    if (d === -1) return styles.scoreBirdie;
    if (d === 1) return styles.scoreBogey;
    if (d >= 2) return styles.scoreDouble;
    return '';
  }

  // Per-team tab: 4-player grid with carrier highlighted (stroke play — no winner column, no summary row)
  function renderYBTeamTab(team) {
    // Use carrier rotation order for columns so players appear in order of play
    const tabIds = carrierOrder?.[team] || match[team]?.playerIds || [];
    const teamColor = team === 'teamA' ? 'var(--teamA)' : 'var(--teamB)';
    const gridStyle = { gridTemplateColumns: `28px repeat(${tabIds.length}, 1fr)` };

    return (
      <div className={styles.scorecardGrid}>
        {/* Header: player first names */}
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          {tabIds.map(id => (
            <span key={id} style={{ textAlign: 'center', color: teamColor, fontWeight: 700, fontSize: '13px' }}>
              {players[id]?.name?.split(' ')[0] || id}
            </span>
          ))}
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const carrierForHole = getCarrier(h, team);
          const holePar = courseHoles[h]?.par;

          return (
            <div key={`hole-${h}`} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {tabIds.map(id => {
                const s = hd[id];
                const isCarrier = carrierForHole === id;
                const shapeClass = ybScoreShape(s?.gross, holePar);
                return (
                  <span key={id} className={styles.scScore}>
                    <span className={styles.dotSlot} />
                    <span className={`${styles.scorePill} ${isCarrier ? styles.ybCarrier : ''} ${shapeClass}`}>
                      {s?.gross ?? '—'}
                    </span>
                    <span className={styles.dotSlot} />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // Score tab: Hole | NW | NE | running cumulative diff
  function renderYBScoreTab() {
    // Compute final totals for the persistent totals row
    let cumA = 0, cumB = 0;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (hd?.ybNetA != null) cumA += hd.ybNetA;
      if (hd?.ybNetB != null) cumB += hd.ybNetB;
    }
    const totalDiff = cumA - cumB;
    const teamAName = tournament?.teamA?.name || 'Team A';
    const teamBName = tournament?.teamB?.name || 'Team B';
    const gridStyle = { gridTemplateColumns: '28px 1fr 1fr 36px' };

    return (
      <div className={styles.scorecardGrid}>
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          <span style={{ textAlign: 'center', color: 'var(--teamA)', fontWeight: 700, fontSize: '13px' }}>{teamAName}</span>
          <span style={{ textAlign: 'center', color: 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>{teamBName}</span>
          <span />
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const carrierAId = getCarrier(h, 'teamA');
          const carrierBId = getCarrier(h, 'teamB');
          const scoreA = hd[carrierAId];
          const scoreB = hd[carrierBId];
          const holePar = courseHoles[h]?.par;

          // Running cumulative diff through this hole
          let runA = 0, runB = 0;
          for (let hh = 1; hh <= h; hh++) {
            const hhd = holeData[hh];
            if (hhd?.ybNetA != null) runA += hhd.ybNetA;
            if (hhd?.ybNetB != null) runB += hhd.ybNetB;
          }
          const holePlayed = hd.ybNetA != null && hd.ybNetB != null;
          const runDiff = runA - runB;
          const diffLabel = !holePlayed ? ''
            : runDiff === 0 ? 'E'
            : `${Math.abs(runDiff)} up`;
          const diffColor = !holePlayed ? 'var(--text-muted)'
            : runDiff < 0 ? 'var(--teamA)'
            : runDiff > 0 ? 'var(--teamB)'
            : 'var(--text-muted)';

          return (
            <div key={h} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {[{ carrierId: carrierAId, score: scoreA }, { carrierId: carrierBId, score: scoreB }].map(({ carrierId, score }, idx) => (
                <span key={idx} className={styles.scScore}>
                  <span className={styles.dotSlot} />
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 7 }}>
                    <span className={`${styles.scorePill} ${score?.gross ? styles.ybCarrier : ''} ${ybScoreShape(score?.gross, holePar)}`}>
                      {score?.gross ?? '—'}
                    </span>
                    {carrierId && (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>
                        {players[carrierId]?.name?.split(' ')[0] || ''}
                      </span>
                    )}
                  </span>
                  <span className={styles.dotSlot} />
                </span>
              ))}
              <span style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: diffColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {diffLabel}
              </span>
            </div>
          );
        })}

        {/* Persistent cumulative totals */}
        <div style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
          <span className={styles.scHole} style={{ fontSize: 10, color: 'var(--yellow)' }}>🟡</span>
          {[{ cum: cumA, color: 'var(--teamA)' }, { cum: cumB, color: 'var(--teamB)' }].map(({ cum, color }, idx) => (
            <span key={idx} className={styles.scScore}>
              <span className={styles.dotSlot} />
              <span className={styles.scorePill} style={{ color, fontWeight: 700 }}>{cum > 0 ? cum : '—'}</span>
              <span className={styles.dotSlot} />
            </span>
          ))}
          <span style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: totalDiff < 0 ? 'var(--teamA)' : totalDiff > 0 ? 'var(--teamB)' : 'var(--text-muted)' }}>
            {cumA === 0 && cumB === 0 ? '' : totalDiff === 0 ? 'E' : `${Math.abs(totalDiff)} up`}
          </span>
        </div>
      </div>
    );
  }

  function renderFoursomesScorecard() {
    const gridStyle = { gridTemplateColumns: '28px 1fr 1fr 26px 48px' };
    const teamAIds = match.teamA?.playerIds || [];
    const teamBIds = match.teamB?.playerIds || [];
    const pairNameA = teamAIds.map(id => players[id]?.name?.split(' ')[0]).join(' & ');
    const pairNameB = teamBIds.map(id => players[id]?.name?.split(' ')[0]).join(' & ');
    const allocA = match.strokeAllocation?.teamA?.holes || [];
    const allocB = match.strokeAllocation?.teamB?.holes || [];

    function pairScorePill(score, alloc, h) {
      const holePar = courseHoles[h]?.par;
      const scoreDiff = (score?.gross && holePar) ? score.gross - holePar : null;
      const shapeClass = scoreDiff === null ? ''
        : scoreDiff <= -2 ? styles.scoreEagle
        : scoreDiff === -1 ? styles.scoreBirdie
        : scoreDiff === 1 ? styles.scoreBogey
        : scoreDiff >= 2 ? styles.scoreDouble : '';
      return (
        <span className={styles.scScore}>
          <span className={styles.dotSlot} />
          <span className={`${styles.scorePill} ${shapeClass}`}>{score?.gross ?? '—'}</span>
          <span className={styles.dotSlot}>
            {alloc.includes(h) && <span className={styles.strokeMark} />}
          </span>
        </span>
      );
    }

    const toParForPair = (pairKey, alloc) => {
      let sum = 0, played = 0;
      for (let hh = 1; hh <= 18; hh++) {
        const s = holeData[hh]?.[pairKey];
        const par = courseHoles[hh]?.par;
        if (s?.gross && par) { sum += s.gross - par; played++; }
      }
      return played === 0 ? '—' : sum === 0 ? 'E' : sum > 0 ? `+${sum}` : `${sum}`;
    };

    return (
      <div className={styles.scorecardGrid}>
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          <span style={{ textAlign: 'center', color: 'var(--teamA)', fontWeight: 700, fontSize: '13px' }}>{pairNameA}</span>
          <span style={{ textAlign: 'center', color: 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>{pairNameB}</span>
          <span /><span />
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const winner = hd.holeWinner;
          const st = scorecardStatus[h];
          const stColor = st?.team === 'teamA' ? 'var(--teamA)' : st?.team === 'teamB' ? 'var(--teamB)' : 'var(--text-muted)';
          const isLastPlayed = !!hd.holeWinner && !holeData[h + 1]?.holeWinner;

          const holeRow = (
            <div key={`hole-${h}`} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {pairScorePill(hd.teamA, allocA, h)}
              {pairScorePill(hd.teamB, allocB, h)}
              <span className={styles.scWinner}>
                {winner === 'half' ? <span className={styles.halfMark}>½</span> : winner ? <TeamLogo teamId={winner} size={18} /> : null}
              </span>
              <span className={styles.scStatus} style={st ? { color: stColor } : {}}>{st?.text ?? ''}</span>
            </div>
          );

          if (!isLastPlayed) return holeRow;

          const toParA = toParForPair('teamA', allocA);
          const toParB = toParForPair('teamB', allocB);
          const colorFor = (str) => str.startsWith('-') ? 'var(--green)' : str === 'E' ? 'var(--text-muted)' : '#c0392b';

          return [
            holeRow,
            <div key={`topar-${h}`} style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
              <span className={styles.scHole} style={{ fontSize: 9, color: 'var(--text-muted)' }}>vs par</span>
              {[['teamA', toParA], ['teamB', toParB]].map(([key, str]) => (
                <span key={key} className={styles.scScore}>
                  <span className={styles.dotSlot} />
                  <span className={styles.scorePill} style={{ color: colorFor(str), fontWeight: 700 }}>{str}</span>
                  <span className={styles.dotSlot} />
                </span>
              ))}
              <span /><span />
            </div>,
          ];
        })}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')}>‹ Back</button>
        <div className={styles.matchStatus}>{matchStatus}</div>
      </div>

      {/* Teams */}
      <div className={styles.teams}>
        <div className={`${styles.teamPill} ${styles.teamA}`}>
          {isYellowBall ? (tournament?.teamA?.name || 'Team A') : match.teamA?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
        <div className={styles.vsLabel}>vs</div>
        <div className={`${styles.teamPill} ${styles.teamB}`}>
          {isYellowBall ? (tournament?.teamB?.name || 'Team B') : match.teamB?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
      </div>

      {/* Hole selector */}
      <div className={styles.holeNav}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
          const played = !!holeData[h]?.holeWinner;
          return (
            <button
              key={h}
              className={`${styles.holeBtn} ${currentHole === h ? styles.holeCurrent : ''} ${played ? styles.holeDone : ''}`}
              onClick={() => setCurrentHole(h)}
            >
              {h}
            </button>
          );
        })}
      </div>

      {/* Current hole info */}
      <div className={styles.holeInfo}>
        <span className={styles.holeLabel}>Hole {currentHole}</span>
        <span className={styles.holePar}>Par {hole.par || '—'}</span>
        <span className={styles.holeSI}>Handicap {hole.strokeIndex || '—'}</span>
        {receiveStroke && !isYellowBall && <span className={styles.strokeDot}>+1 stroke</span>}
      </div>

      {/* Score entry */}
      {isMyMatch && !roundComplete && (
        <div className={styles.entryCard}>
          {/* Admin: player/pair picker; or player label for non-admin */}
          {isAdmin && isFoursomes ? (
            <div className={styles.field}>
              <label style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Entering for
              </label>
              <select
                value={entryForId || 'teamA'}
                onChange={e => setEntryForId(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}
              >
                <option value="teamA">{tournament?.teamA?.name || 'Team A'}: {match.teamA?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}</option>
                <option value="teamB">{tournament?.teamB?.name || 'Team B'}: {match.teamB?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}</option>
              </select>
            </div>
          ) : isAdmin ? (
            <div className={styles.field}>
              <label style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Entering for
              </label>
              <select
                value={entryForId || ''}
                onChange={e => setEntryForId(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '16px', fontWeight: 600, color: 'var(--text)', maxWidth: '180px' }}
              >
                {allPlayerIds.map(id => {
                  const isTeamA = match.teamA?.playerIds?.includes(id);
                  return (
                    <option key={id} value={id}>
                      {players[id]?.name || id} ({isTeamA ? tournament?.teamA?.name || 'A' : tournament?.teamB?.name || 'B'})
                    </option>
                  );
                })}
              </select>
            </div>
          ) : isFoursomes ? (
            <div className={styles.entryLabel}>
              Pair score — {match[myTeam]?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}
            </div>
          ) : (
            <div className={styles.entryLabel}>Your score — {players[playerId]?.name}</div>
          )}

          {isYellowBall && (
            <div className={myYBCarrier ? styles.ybBannerCarrying : styles.ybBannerWatching}>
              {myYBCarrier
                ? '🟡 You have the yellow ball this hole'
                : `🟡 Yellow ball: ${players[ybCarrierA]?.name?.split(' ')[0] ?? '?'} & ${players[ybCarrierB]?.name?.split(' ')[0] ?? '?'}`}
            </div>
          )}

          {/* Score widget: top = gross + annotation, bottom = net section */}
          <div className={styles.grossRow}>
            <div />
            <div className={styles.scoreWidget}>
              <div className={styles.stepper}>
                <button onClick={() => setEntry((e) => ({ ...e, gross: Math.max(1, (parseInt(e.gross) || 0) - 1) }))}>−</button>
                <span className={`${styles.grossNum} ${stepperAnnotation}`}>{entry.gross || '—'}</span>
                <button onClick={() => setEntry((e) => ({ ...e, gross: (parseInt(e.gross) || 0) + 1 }))}>+</button>
              </div>
              {net !== null && !isYellowBall && (
                <div className={styles.netSection}>Net {net}{receiveStroke ? ' ●' : ''}</div>
              )}
            </div>
            <div />
          </div>

          {/* FW / GIR + putts all on one row */}
          <div className={styles.statsRow}>
            {!isPar3 && (
              <button
                className={`${styles.statPill} ${entry.fairwayHit === true ? styles.statPillOn : ''}`}
                onClick={() => setEntry((e) => ({ ...e, fairwayHit: e.fairwayHit === true ? false : true }))}
              >
                FW
              </button>
            )}
            <button
              className={`${styles.statPill} ${entry.gir ? styles.statPillOn : ''}`}
              onClick={() => setEntry((e) => ({ ...e, gir: !e.gir }))}
            >
              GIR
            </button>
            <div className={styles.statDivider} />
            <span className={styles.puttsLabel}>Putts</span>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={`${styles.puttsPill} ${entry.putts === n ? styles.puttsPillOn : ''}`}
                onClick={() => setEntry((e) => ({ ...e, putts: e.putts === n ? '' : n }))}
              >
                {n}
              </button>
            ))}
          </div>

          {justSaved ? (
            <div className={styles.savedBanner}>✓ Saved!</div>
          ) : (
            <button
              className={styles.submitBtn}
              onClick={submitHole}
              disabled={!gross || (isAdmin && !effectivePlayerId)}
            >
              {isFoursomes
                ? `Save Pair Score — Hole ${currentHole}`
                : `Save${isAdmin ? ` ${players[effectivePlayerId]?.name?.split(' ')[0] ?? ''}'s` : ''} Hole ${currentHole}`}
            </button>
          )}

          {waitingOn.length > 0 && (
            <div className={styles.waitingMsg}>
              Waiting on {waitingOn.map(id => {
                if (id === '__pair__') {
                  const opp = myTeam === 'teamA' ? 'teamB' : 'teamA';
                  return match[opp]?.playerIds?.map(pid => players[pid]?.name?.split(' ')[0]).join(' & ');
                }
                return players[id]?.name?.split(' ')[0];
              }).join(', ')}…
            </div>
          )}
        </div>
      )}

      {/* Match result banner — shown when match is decided or round complete */}
      {resultInfo && (
        <div className={styles.resultBanner}>
          {resultInfo.winner ? (
            <>
              <span style={{ color: `var(--${resultInfo.winner})` }}>
                {isFoursomes || isYellowBall
                  ? tournament?.[resultInfo.winner]?.name
                  : match[resultInfo.winner]?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}
              </span>
              {' win — '}{resultInfo.text}
            </>
          ) : resultInfo.text}
        </div>
      )}

      {/* Scorecard / Bets page-level tab switcher */}
      <div className={styles.matchTabs}>
        <button
          className={`${styles.matchTabBtn} ${matchTab === 'scorecard' ? styles.matchTabActive : ''}`}
          onClick={() => setMatchTab('scorecard')}
        >
          Scorecard
        </button>
        <button
          className={`${styles.matchTabBtn} ${matchTab === 'bets' ? styles.matchTabActive : ''}`}
          onClick={() => setMatchTab('bets')}
        >
          💰 Bets
        </button>
      </div>

      {matchTab === 'bets' && (
        <MatchBetsTab
          matchId={matchId}
          holeData={holeData}
          players={players}
          nassauBets={nassauBets}
          customBets={customBets}
          allPlayerIds={allPlayerIds}
          playerId={playerId}
          isAdmin={isAdmin}
        />
      )}

      {/* Scorecard */}
      {matchTab === 'scorecard' && (
      <div className={styles.scorecard}>
        <div className={styles.sectionLabel}>Scorecard</div>

        {isFoursomes ? renderFoursomesScorecard() : isYellowBall ? (
          <>
            <div className={styles.ybTabs}>
              <button
                className={`${styles.ybTabBtn} ${activeYbTab === 'teamA' ? styles.ybTabActive : ''}`}
                style={activeYbTab === 'teamA' ? { color: 'var(--teamA)', borderColor: 'var(--teamA)' } : {}}
                onClick={() => setYbTab('teamA')}
              >
                {tournament?.teamA?.name || 'Team A'}
              </button>
              <button
                className={`${styles.ybTabBtn} ${activeYbTab === 'teamB' ? styles.ybTabActive : ''}`}
                style={activeYbTab === 'teamB' ? { color: 'var(--teamB)', borderColor: 'var(--teamB)' } : {}}
                onClick={() => setYbTab('teamB')}
              >
                {tournament?.teamB?.name || 'Team B'}
              </button>
              <button
                className={`${styles.ybTabBtn} ${activeYbTab === 'score' ? styles.ybTabActive : ''}`}
                style={activeYbTab === 'score' ? { color: 'var(--yellow)', borderColor: 'var(--yellow)' } : {}}
                onClick={() => setYbTab('score')}
              >
                🟡 Score
              </button>
            </div>
            {activeYbTab === 'teamA' && renderYBTeamTab('teamA')}
            {activeYbTab === 'teamB' && renderYBTeamTab('teamB')}
            {activeYbTab === 'score' && renderYBScoreTab()}
          </>
        ) : (
          <div className={styles.scorecardGrid}>
            <div
              className={`${styles.scRow} ${styles.scHeader}`}
              style={{ gridTemplateColumns: `28px repeat(${allPlayerIds.length}, 1fr) 26px 48px` }}
            >
              <span />
              {allPlayerIds.map((id) => {
                const isTeamA = match.teamA?.playerIds?.includes(id);
                return (
                  <span key={id} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ color: isTeamA ? 'var(--teamA)' : 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>
                      {players[id]?.name?.split(' ')[0] || id}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>
                      hcp {players[id]?.handicap ?? '—'}
                    </span>
                  </span>
                );
              })}
              <span /><span />
            </div>

            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
              const hd = holeData[h] || {};
              const winner = hd.holeWinner;
              const holePar = courseHoles[h]?.par;

              const carriers = new Set();
              ['teamA', 'teamB'].forEach((team) => {
                const ids = match[team]?.playerIds || [];
                const nets = ids.map((id) => ({ id, net: hd[id]?.net })).filter((x) => x.net != null);
                if (!nets.length) return;
                const best = Math.min(...nets.map((x) => x.net));
                nets.filter((x) => x.net === best).forEach((x) => carriers.add(x.id));
              });

              const gridStyle = { gridTemplateColumns: `28px repeat(${allPlayerIds.length}, 1fr) 26px 48px` };
              const isLastPlayed = !!hd.holeWinner && !holeData[h + 1]?.holeWinner;

              // Running match status for the rightmost column
              const st = scorecardStatus[h];
              const stColor = st?.team === 'teamA' ? 'var(--teamA)'
                : st?.team === 'teamB' ? 'var(--teamB)'
                : 'var(--text-muted)';

              const holeRow = (
                <div key={`hole-${h}`} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
                  <span className={styles.scHole}>{h}</span>
                  {allPlayerIds.map((id) => {
                    const s = hd[id];
                    const alloc = match.strokeAllocation?.[id]?.holes || [];
                    const isCarrier = carriers.has(id);
                    const isTeamA = match.teamA?.playerIds?.includes(id);
                    const carrierClass = isCarrier ? (isTeamA ? styles.carrierA : styles.carrierB) : '';
                    const scoreDiff = (s?.gross && holePar) ? s.gross - holePar : null;
                    const shapeClass = scoreDiff === null ? ''
                      : scoreDiff <= -2 ? styles.scoreEagle
                      : scoreDiff === -1 ? styles.scoreBirdie
                      : scoreDiff === 1 ? styles.scoreBogey
                      : scoreDiff >= 2 ? styles.scoreDouble
                      : '';
                    return (
                      <span key={id} className={styles.scScore}>
                        <span className={styles.dotSlot} />
                        <span className={`${styles.scorePill} ${carrierClass} ${shapeClass}`}>
                          {s ? s.gross : '—'}
                        </span>
                        <span className={styles.dotSlot}>
                          {alloc.includes(h) && <span className={styles.strokeMark} />}
                        </span>
                      </span>
                    );
                  })}
                  {/* Hole winner icon */}
                  <span className={styles.scWinner}>
                    {winner === 'half' ? <span className={styles.halfMark}>½</span> : winner ? <TeamLogo teamId={winner} size={18} /> : null}
                  </span>
                  {/* Running match score */}
                  <span className={styles.scStatus} style={st ? { color: stColor } : {}}>
                    {st?.text ?? ''}
                  </span>
                </div>
              );

              if (!isLastPlayed) return holeRow;

              const toParCells = allPlayerIds.map(id => {
                let sum = 0, played = 0;
                for (let hh = 1; hh <= 18; hh++) {
                  const s = holeData[hh]?.[id];
                  const par = courseHoles[hh]?.par;
                  if (s?.gross && par) { sum += s.gross - par; played++; }
                }
                const str = played === 0 ? '—' : sum === 0 ? 'E' : sum > 0 ? `+${sum}` : `${sum}`;
                const color = sum < 0 ? 'var(--green)' : sum > 0 ? '#c0392b' : 'var(--text-muted)';
                return { id, str, color };
              });

              return [
                holeRow,
                <div key={`topar-${h}`} style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
                  <span className={styles.scHole} style={{ fontSize: 9, color: 'var(--text-muted)' }}>vs par</span>
                  {toParCells.map(({ id, str, color }) => (
                    <span key={id} className={styles.scScore}>
                      <span className={styles.dotSlot} />
                      <span className={`${styles.scorePill}`} style={{ color, fontWeight: 700 }}>{str}</span>
                      <span className={styles.dotSlot} />
                    </span>
                  ))}
                  <span /><span />
                </div>,
              ];
            })}
          </div>
        )}
      </div>
      )}

      <div className={styles.bottomPad} />
    </div>
  );
}
