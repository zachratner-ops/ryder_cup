import { useEffect, useRef, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, set, update, push, runTransaction } from 'firebase/database';
import { db } from '../firebase';
import { enqueue, dequeueAll, removeById, getQueueLength } from '../offlineQueue';
import TeamLogo from '../components/TeamLogo';
import styles from './Match.module.css';
import {
  computeNassauStatus,
  computeSegmentStatus,
  computePressPayout,
  canPress,
  formatSegmentStatus,
} from '../nassauCompute';
import SkinsBetCard from '../components/SkinsBetCard';

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

function MatchBetsTab({ matchId, holeData, players, nassauBets, customBets, skinsBets, match, allPlayerIds, playerId, isAdmin }) {
  const [presses, setPresses] = useState({});
  const [confirmPress, setConfirmPress] = useState(null); // { nassauBetId, segment, pressId?, startHole, endHole, amount }
  const [showCreate, setShowCreate] = useState(false);
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState('');

  // Nassau create form (pre-filled to this match)
  const [nassauMode, setNassauMode] = useState('1v1'); // '1v1' | '2v2'
  const [newOpponent, setNewOpponent] = useState('');
  const [newAmount, setNewAmount] = useState('');
  const [pressThreshold, setPressThreshold] = useState(2);
  const [newCompFront, setNewCompFront] = useState(true);
  const [newCompBack, setNewCompBack] = useState(true);
  const [newCompOverall, setNewCompOverall] = useState(true);
  const [newCompCustom, setNewCompCustom] = useState(false);
  const [newCustomStart, setNewCustomStart] = useState('');
  const [newCustomEnd, setNewCustomEnd] = useState('');

  // Skins create form
  const [skinsAmount, setSkinsAmount] = useState('');
  const [skinsStartHole, setSkinsStartHole] = useState('1');
  const [skinsEndHole, setSkinsEndHole] = useState('18');
  const [skinsPlayers, setSkinsPlayers] = useState(allPlayerIds);

  // Scramble has no per-player scores, so Nassau and skins can't resolve — custom bets only
  const scrambleMatch = match?.format === 'scramble';

  // Custom create form
  const [createTab, setCreateTab] = useState(scrambleMatch ? 'custom' : 'nassau');
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

  // Skins bets for this match
  const matchSkinsBets = useMemo(() =>
    Object.entries(skinsBets).filter(([, b]) => b.matchId === matchId),
    [skinsBets, matchId]
  );

  const betCount = matchNassauBets.length + matchCustomBets.length + matchSkinsBets.length;

  async function handleCreateSkins() {
    const s = parseInt(skinsStartHole), e = parseInt(skinsEndHole);
    if (!skinsAmount || parseFloat(skinsAmount) <= 0) { setCreateError('Enter a dollar amount per skin.'); return; }
    if (skinsPlayers.length < 2) { setCreateError('Select at least 2 players.'); return; }
    if (!s || !e || s < 1 || e > 18 || s >= e) { setCreateError('Invalid hole range.'); return; }
    setCreateLoading(true);
    setCreateError('');
    try {
      await push(ref(db, 'skinsBets'), {
        matchId,
        players: skinsPlayers,
        amount: parseFloat(skinsAmount),
        startHole: s,
        endHole: e,
        createdBy: playerId || 'unknown',
        createdAt: Date.now(),
        status: 'open',
      });
      setShowCreate(false);
      setSkinsAmount('');
    } catch (err) {
      setCreateError(err.message);
    } finally {
      setCreateLoading(false);
    }
  }

  async function handleCreateNassau() {
    const myId = isAdmin ? null : playerId;

    if (nassauMode === '2v2') {
      if (!newAmount) { setCreateError('Enter an amount.'); return; }
      const components = [];
      if (newCompFront) components.push({ label: 'Front 9', startHole: 1, endHole: 9 });
      if (newCompBack) components.push({ label: 'Back 9', startHole: 10, endHole: 18 });
      if (newCompOverall) components.push({ label: 'Overall', startHole: 1, endHole: 18 });
      if (newCompCustom) {
        const cs = parseInt(newCustomStart), ce = parseInt(newCustomEnd);
        if (!cs || !ce || cs < 1 || ce > 18 || cs >= ce) {
          setCreateError('Custom range: enter valid holes (1–18, start < end).');
          return;
        }
        components.push({ label: `Holes ${cs}–${ce}`, startHole: cs, endHole: ce });
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
            mode: '2v2',
            playerA: 'teamA',
            playerB: 'teamB',
            teamAIds: match?.teamA?.playerIds || [],
            teamBIds: match?.teamB?.playerIds || [],
            amount: parseFloat(newAmount),
            components,
            pressThreshold,
            createdBy: myId || 'admin',
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Failed');
        setShowCreate(false);
        setNewAmount('');
        setNewCompFront(true); setNewCompBack(true); setNewCompOverall(true);
        setNewCompCustom(false); setNewCustomStart(''); setNewCustomEnd('');
      } catch (err) {
        setCreateError(err.message);
      } finally {
        setCreateLoading(false);
      }
      return;
    }

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
          pressThreshold,
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
      alert(`Settle failed: ${e.message}`);
      return;
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
      alert(`Press failed: ${e.message}`);
    }
    setConfirmPress(null);
  }

  // Render a press button for a segment (or a press-of-press)
  function renderPressButton(nassauBet, betId, segStatus, startHole, endHole, segment, parentPressId) {
    if (!playerId) return null; // spectator can't press
    const isPlayerA = nassauBet.playerA === playerId;
    const isPlayerB = nassauBet.playerB === playerId;
    if (!isPlayerA && !isPlayerB) return null;

    if (!canPress(segStatus, isPlayerA, startHole, endHole, nassauBet.pressThreshold ?? 2)) return null;

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
    const nameA = betFirstName(players, nassauBet.playerA);
    const nameB = betFirstName(players, nassauBet.playerB);
    return (
      <div className={styles.pressRows}>
        {childPresses.map(([pressId, press]) => {
          const segStatus = computeSegmentStatus(holeData, nassauBet, press.startHole, press.endHole);
          const pressDecided = segStatus.winner !== 'incomplete';
          const statusStr = formatSegmentStatus(segStatus, nameA, nameB, press.startHole, press.endHole);
          const pressWinnerPid = segStatus.winner === 'playerA' ? nassauBet.playerA : segStatus.winner === 'playerB' ? nassauBet.playerB : null;
          const pressLoserPid = segStatus.winner === 'playerA' ? nassauBet.playerB : segStatus.winner === 'playerB' ? nassauBet.playerA : null;
          const pressWinnerName = pressWinnerPid ? betFirstName(players, pressWinnerPid) : null;
          const pressLoserName = pressLoserPid ? betFirstName(players, pressLoserPid) : null;
          return (
            <div key={pressId}>
              <div className={styles.pressRow}>
                <span className={styles.pressLabel}>Press {press.startHole}–{press.endHole}</span>
                <span className={`${styles.pressStatus} ${pressDecided && segStatus.winner !== 'half' ? styles.pressStatusDecided : ''}`}>
                  {statusStr}
                </span>
                {!pressDecided && renderPressButton(nassauBet, betId, segStatus, press.startHole, press.endHole, null, pressId)}
                {pressDecided && (
                  <div className={styles.pressPayout}>
                    {segStatus.winner === 'half' ? (
                      <span className={styles.pressPayoutHalved}>Halved</span>
                    ) : (
                      <>
                        <span className={styles.pressPayoutWinner}>{pressWinnerName} +${nassauBet.amount}</span>
                        <span className={styles.pressPayoutLoser}>{pressLoserName} -${nassauBet.amount}</span>
                      </>
                    )}
                  </div>
                )}
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
    const is2v2 = bet.mode === '2v2';
    const nameA = is2v2
      ? (bet.teamAIds || []).map(id => players[id]?.name?.split(' ')[0] || id).join(' & ')
      : betFirstName(players, bet.playerA);
    const nameB = is2v2
      ? (bet.teamBIds || []).map(id => players[id]?.name?.split(' ')[0] || id).join(' & ')
      : betFirstName(players, bet.playerB);
    const colorA = is2v2 ? 'var(--teamA)' : betTeamColor(players, bet.playerA);
    const colorB = is2v2 ? 'var(--teamB)' : betTeamColor(players, bet.playerB);

    return (
      <div key={betId} className={styles.nassauCard}>
        <div className={styles.nassauCardHeader}>
          <div className={styles.nassauPlayers}>
            <span style={{ color: colorA }}>{nameA}</span>
            <span className={styles.nassauVs}>vs</span>
            <span style={{ color: colorB }}>{nameB}</span>
          </div>
          <div className={styles.nassauMeta}>${bet.amount}/comp{is2v2 ? ' · 2v2' : ''} · press {bet.pressThreshold ?? 2}-down</div>
        </div>

        <div className={styles.nassauSegments}>
          {componentStatuses.map(({ label, startHole, endHole, status: s }) => {
            const statusStr = formatSegmentStatus(s, nameA, nameB, startHole, endHole);
            const decided = s.winner !== 'incomplete';

            // Segment-level presses keyed by label
            const segPresses = Object.entries(presses).filter(([, p]) =>
              p.nassauBetId === betId && p.segment === label && p.parentPressId == null
            );

            // Block: only accent left-bar while in progress; no tinting when decided
            const blockMod = !decided && s.holesPlayed > 0 ? styles.nassauSegBlockInProgress : '';

            const winnerPlayerId =
              s.winner === 'playerA' ? bet.playerA :
              s.winner === 'playerB' ? bet.playerB : null;
            const loserPlayerId =
              s.winner === 'playerA' ? bet.playerB :
              s.winner === 'playerB' ? bet.playerA : null;
            const winnerName = winnerPlayerId ? betFirstName(players, winnerPlayerId) : null;
            const loserName = loserPlayerId ? betFirstName(players, loserPlayerId) : null;

            return (
              <div key={label} className={`${styles.nassauSegBlock} ${blockMod}`}>
                <div className={styles.nassauSegBlockHeader}>
                  <span className={styles.nassauSegLabel}>{label}</span>
                </div>
                <div className={styles.nassauSegRow}>
                  <span className={`${styles.nassauSegStatus} ${
                    decided && s.winner !== 'half' ? styles.nassauSegStatusWon :
                    s.holesPlayed === 0 ? styles.nassauSegStatusMuted : ''
                  }`}>
                    {statusStr}
                  </span>
                  {!decided && renderPressButton(bet, betId, s, startHole, endHole, label, null)}
                  {decided && s.winner !== 'half' && (
                    <div className={styles.nassauSegPayoutLines}>
                      <span className={styles.nassauSegPayoutWinner}>{winnerName} +${bet.amount}</span>
                      <span className={styles.nassauSegPayoutLoser}>{loserName} -${bet.amount}</span>
                    </div>
                  )}
                  {decided && s.winner === 'half' && (
                    <span className={styles.nassauSegPayoutHalved}>Halved — no money</span>
                  )}
                </div>

                {/* Segment-level presses */}
                {segPresses.length > 0 && (
                  <div className={styles.pressRows}>
                    {segPresses.map(([pressId, press]) => {
                      const pressStatus = computeSegmentStatus(holeData, bet, press.startHole, press.endHole);
                      const pressDecided = pressStatus.winner !== 'incomplete';
                      const pressStatusStr = formatSegmentStatus(pressStatus, nameA, nameB, press.startHole, press.endHole);
                      const pressWinnerPid = pressStatus.winner === 'playerA' ? bet.playerA : pressStatus.winner === 'playerB' ? bet.playerB : null;
                      const pressLoserPid = pressStatus.winner === 'playerA' ? bet.playerB : pressStatus.winner === 'playerB' ? bet.playerA : null;
                      const pressWinnerName = pressWinnerPid ? betFirstName(players, pressWinnerPid) : null;
                      const pressLoserName = pressLoserPid ? betFirstName(players, pressLoserPid) : null;
                      return (
                        <div key={pressId}>
                          <div className={styles.pressRow}>
                            <span className={styles.pressLabel}>Press {press.startHole}–{press.endHole}</span>
                            <span className={`${styles.pressStatus} ${pressDecided && pressStatus.winner !== 'half' ? styles.pressStatusDecided : ''}`}>
                              {pressStatusStr}
                            </span>
                            {!pressDecided && renderPressButton(bet, betId, pressStatus, press.startHole, press.endHole, null, pressId)}
                            {pressDecided && (
                              <div className={styles.pressPayout}>
                                {pressStatus.winner === 'half' ? (
                                  <span className={styles.pressPayoutHalved}>Halved</span>
                                ) : (
                                  <>
                                    <span className={styles.pressPayoutWinner}>{pressWinnerName} +${bet.amount}</span>
                                    <span className={styles.pressPayoutLoser}>{pressLoserName} -${bet.amount}</span>
                                  </>
                                )}
                              </div>
                            )}
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

      {/* Skins bets */}
      {matchSkinsBets.map(([betId, bet]) => (
        <SkinsBetCard
          key={betId}
          bet={bet}
          holeData={holeData}
          players={players}
        />
      ))}

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

      {/* Create bet modal */}
      {showCreate && (
        <div className={styles.overlay} onClick={() => { setShowCreate(false); setCreateError(''); }}>
        <div className={styles.sheet} onClick={e => e.stopPropagation()}>
          <div className={styles.sheetHandle} />
          <div className={styles.sheetTitle}>Add Bet</div>
          <div className={styles.ybTabs} style={{ marginBottom: 2 }}>
            {!scrambleMatch && (
            <button
              className={`${styles.ybTabBtn} ${createTab === 'nassau' ? styles.ybTabActive : ''}`}
              style={createTab === 'nassau' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
              onClick={() => { setCreateTab('nassau'); setCreateError(''); }}
            >
              Nassau
            </button>
            )}
            {!scrambleMatch && (
            <button
              className={`${styles.ybTabBtn} ${createTab === 'skins' ? styles.ybTabActive : ''}`}
              style={createTab === 'skins' ? { color: 'var(--accent)', borderColor: 'var(--accent)' } : {}}
              onClick={() => { setCreateTab('skins'); setCreateError(''); setSkinsPlayers(allPlayerIds); }}
            >
              Skins
            </button>
            )}
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
                <div className={styles.sectionLabel}>Format</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {['1v1', '2v2'].map(mode => (
                    <button
                      key={mode}
                      type="button"
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                        border: `1.5px solid ${nassauMode === mode ? 'var(--accent)' : 'var(--border)'}`,
                        background: nassauMode === mode ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                        color: nassauMode === mode ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                      onClick={() => { setNassauMode(mode); setCreateError(''); }}
                    >
                      {mode}
                    </button>
                  ))}
                </div>
              </div>
              {nassauMode === '1v1' && (
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
              )}
              {nassauMode === '2v2' && (
              <div style={{ fontSize: 13, color: 'var(--text-muted)', background: 'var(--surface2)', borderRadius: 8, padding: '10px 12px' }}>
                {(match?.teamA?.playerIds || []).map(id => players[id]?.name?.split(' ')[0] || id).join(' & ')}
                {' vs '}
                {(match?.teamB?.playerIds || []).map(id => players[id]?.name?.split(' ')[0] || id).join(' & ')}
              </div>
              )}
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
                <div className={styles.sectionLabel}>Press when down</div>
                <div style={{ display: 'flex', gap: 8 }}>
                  {[1, 2, 3].map(n => (
                    <button
                      key={n}
                      type="button"
                      style={{
                        flex: 1, padding: '9px 0', borderRadius: 10, fontSize: 14, fontWeight: 700, cursor: 'pointer',
                        border: `1.5px solid ${pressThreshold === n ? 'var(--accent)' : 'var(--border)'}`,
                        background: pressThreshold === n ? 'color-mix(in srgb, var(--accent) 10%, transparent)' : 'var(--surface2)',
                        color: pressThreshold === n ? 'var(--accent)' : 'var(--text-muted)',
                      }}
                      onClick={() => setPressThreshold(n)}
                    >
                      {n}-down
                    </button>
                  ))}
                </div>
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

          {createTab === 'skins' && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <div>
                <div className={styles.sectionLabel}>Players</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {allPlayerIds.map(id => {
                    const on = skinsPlayers.includes(id);
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
                        onClick={() => setSkinsPlayers(prev =>
                          prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]
                        )}
                      >
                        {players[id]?.name?.split(' ')[0] || id}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div>
                <div className={styles.sectionLabel}>Hole Range</div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <input
                    style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 15, color: 'var(--text)', textAlign: 'center' }}
                    type="number" min="1" max="17" placeholder="Start"
                    value={skinsStartHole} onChange={e => setSkinsStartHole(e.target.value)}
                  />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>–</span>
                  <input
                    style={{ flex: 1, background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '10px 12px', fontSize: 15, color: 'var(--text)', textAlign: 'center' }}
                    type="number" min="2" max="18" placeholder="End"
                    value={skinsEndHole} onChange={e => setSkinsEndHole(e.target.value)}
                  />
                </div>
              </div>
              <div>
                <div className={styles.sectionLabel}>$ Per Skin</div>
                <input
                  style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: '11px 14px', fontSize: 15, width: '100%', color: 'var(--text)', boxSizing: 'border-box' }}
                  type="number" min="1" step="1" placeholder="e.g. 5"
                  value={skinsAmount} onChange={e => setSkinsAmount(e.target.value)}
                />
              </div>
              {createError && <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{createError}</p>}
              <button
                style={{ background: 'var(--accent)', color: 'white', border: 'none', borderRadius: 12, padding: 15, fontSize: 16, fontWeight: 700, cursor: 'pointer', opacity: createLoading ? 0.5 : 1 }}
                onClick={handleCreateSkins}
                disabled={createLoading}
              >
                {createLoading ? 'Creating…' : 'Create Skins Bet'}
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
  const [skinsBets, setSkinsBets] = useState({});
  const [entry, setEntry] = useState({ gross: '', fairwayHit: null, gir: false, putts: '' });
  const [justSaved, setJustSaved] = useState(false);
  // syncState: null | 'saving' | 'synced' | { pending: number }
  const [syncState, setSyncState] = useState(null);
  const initialJumped = useRef(false);
  const computeWinnerRef = useRef(null);

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
    const u3 = onValue(ref(db, 'skinsBets'), (s) => setSkinsBets(s.val() || {}));
    return () => { u1(); u2(); u3(); };
  }, [matchTab]);

  // Auto-advance to first unplayed hole on initial load
  useEffect(() => {
    if (initialJumped.current || !match || Object.keys(holeData).length === 0) return;
    const maxH = match.format === 'scramble' && match.holeCount === 9 ? 9 : 18;
    const firstUnplayed = Array.from({ length: maxH }, (_, i) => i + 1)
      .find(h => !holeData[h]?.holeWinner);
    if (firstUnplayed) setCurrentHole(firstUnplayed);
    initialJumped.current = true;
  }, [holeData, match]);

  // Admin: initialise entryForId to first player (or 'teamA' for foursomes/scramble)
  useEffect(() => {
    if (!isAdmin || entryForId || !match) return;
    if (match.format === 'foursomes' || match.format === 'scramble') {
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

  // Keep ref to computeAndWriteHoleWinner current so the online handler can call it
  useEffect(() => {
    computeWinnerRef.current = computeAndWriteHoleWinner;
  });

  // Check for stale offline writes on mount
  useEffect(() => {
    getQueueLength().then(len => { if (len > 0) setSyncState({ pending: len }); });
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Flush offline queue when connectivity restores
  useEffect(() => {
    async function handleOnline() {
      const pending = await dequeueAll();
      if (!pending.length) return;
      setSyncState('saving');
      const flushedHoles = new Set();
      for (const item of pending) {
        try {
          await set(ref(db, item.path), item.value);
          await removeById(item.id);
          const holeNum = parseInt(item.path.split('/')[2]);
          if (!isNaN(holeNum)) flushedHoles.add(holeNum);
        } catch {
          setSyncState({ pending: await getQueueLength() });
          return;
        }
      }
      for (const h of flushedHoles) {
        try { await computeWinnerRef.current?.(h); } catch {}
      }
      setSyncState('synced');
      setTimeout(() => setSyncState(null), 2000);
    }
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

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
  const isScramble = match.format === 'scramble';
  // Foursomes and scramble both enter one score per team, keyed 'teamA'/'teamB'
  const isTeamEntry = isFoursomes || isScramble;
  // Scramble can be a 9-hole round; every other format plays 18
  const holeCount = isScramble && match.holeCount === 9 ? 9 : 18;

  // For team-entry formats, derive team from playerId directly to avoid circular dependency
  const playerTeam = match.teamA?.playerIds?.includes(playerId) ? 'teamA'
    : match.teamB?.playerIds?.includes(playerId) ? 'teamB'
    : 'teamA';

  // The player/pair whose score we're currently entering:
  // • normal mode  → the logged-in player (or playerTeam for foursomes/scramble)
  // • admin mode   → whichever player/pair admin has selected
  // For team-entry formats, effectivePlayerId is 'teamA' or 'teamB' (team key, not a player ID)
  const effectivePlayerId = isTeamEntry
    ? (isAdmin ? (entryForId || 'teamA') : playerTeam)
    : (isAdmin ? (entryForId || null) : playerId);

  // myTeam: for team-entry formats effectivePlayerId is already 'teamA'/'teamB';
  // for other formats derive from which team holds the effectivePlayerId
  const myTeam = isTeamEntry
    ? effectivePlayerId
    : (effectivePlayerId && match.teamA?.playerIds?.includes(effectivePlayerId) ? 'teamA'
      : effectivePlayerId && match.teamB?.playerIds?.includes(effectivePlayerId) ? 'teamB'
      : 'teamA');

  // Per-hole running match status for the non-YB scorecard column
  const scorecardStatus = (() => {
    if (isYellowBall || isScramble) return {};
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
  // Staged matches are visible but locked — scoring opens when the admin starts the round
  const matchLive = match.status === 'active';

  const myHoleScore = holeData[currentHole]?.[effectivePlayerId];
  const iSubmitted = !!myHoleScore?.gross;
  const holeComplete = !!holeData[currentHole]?.holeWinner;
  const waitingOn = (() => {
    if (!iSubmitted || holeComplete) return [];
    if (isTeamEntry) {
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
    if (isScramble) {
      let cumA = 0, cumB = 0, holesPlayed = 0;
      for (let h = 1; h <= holeCount; h++) {
        const hd = holeData[h];
        if (hd?.teamA?.gross == null || hd?.teamB?.gross == null) break;
        cumA += hd.teamA.gross;
        cumB += hd.teamB.gross;
        holesPlayed++;
      }
      if (holesPlayed < holeCount && match.status !== 'complete') return null;
      if (holesPlayed === 0) return null;
      const diff = cumA - cumB;
      const winner = diff < 0 ? 'teamA' : diff > 0 ? 'teamB' : null;
      return { winner, text: diff === 0 ? 'Tied — Halved' : `by ${Math.abs(diff)} stroke${Math.abs(diff) !== 1 ? 's' : ''}` };
    }
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
    const scoreData = {
      gross,
      net,
      fairwayHit: isPar3 ? null : entry.fairwayHit,
      gir: entry.gir,
      putts: entry.putts !== '' ? parseInt(entry.putts) : null,
    };

    // Optimistic local update so scorecard reflects the entry immediately
    setHoleData(prev => ({
      ...prev,
      [currentHole]: { ...(prev[currentHole] || {}), [effectivePlayerId]: scoreData },
    }));

    const path = `holes/${matchId}/${currentHole}/${effectivePlayerId}`;

    if (navigator.onLine) {
      setSyncState('saving');
      try {
        await set(ref(db, path), scoreData);
        await computeAndWriteHoleWinner(currentHole);
        setSyncState('synced');
        setTimeout(() => setSyncState(null), 2000);
      } catch {
        await enqueue(path, scoreData);
        const pending = await getQueueLength();
        setSyncState({ pending });
      }
    } else {
      await enqueue(path, scoreData);
      const pending = await getQueueLength();
      setSyncState({ pending });
    }

    setJustSaved(true);
    setTimeout(() => {
      setJustSaved(false);
      // Admin stays on the same hole so they can move to the next player
      if (!isAdmin && currentHole < holeCount) setCurrentHole(h => h + 1);
    }, 900);
  }

  async function computeAndWriteHoleWinner(holeNum) {
    const teamAIds = match.teamA?.playerIds || [];
    const teamBIds = match.teamB?.playerIds || [];
    const holeRef = ref(db, `holes/${matchId}/${holeNum}`);

    // Transaction: winner is always computed from the hole's current scores,
    // so two players saving simultaneously can't decide it from stale data.
    await runTransaction(holeRef, (scores) => {
      if (!scores) return scores;

      if (isTeamEntry) {
        const scoreA = scores.teamA;
        const scoreB = scores.teamB;
        if (scoreA?.net == null || scoreB?.net == null) return scores;
        const winner = scoreA.net < scoreB.net ? 'teamA' : scoreA.net > scoreB.net ? 'teamB' : 'half';
        if (isScramble) {
          // Stroke play — hole winner is display-only, no match-play status
          return { ...scores, holeWinner: winner };
        }
        const status = computeMatchStatus({ ...holeData, [holeNum]: { holeWinner: winner } }, [], []);
        return { ...scores, holeWinner: winner, matchStatus: status };
      }

      if (isYellowBall) {
        const carrierAId = getCarrier(holeNum, 'teamA');
        const carrierBId = getCarrier(holeNum, 'teamB');
        const ybNetA = scores[carrierAId]?.net;
        const ybNetB = scores[carrierBId]?.net;
        if (ybNetA == null || ybNetB == null) return scores;
        const winner = ybNetA < ybNetB ? 'teamA' : ybNetA > ybNetB ? 'teamB' : 'half';
        return { ...scores, holeWinner: winner, ybNetA, ybNetB };
      }

      const teamANets = teamAIds.map((id) => scores[id]?.net).filter((n) => n != null);
      const teamBNets = teamBIds.map((id) => scores[id]?.net).filter((n) => n != null);
      if (teamANets.length < teamAIds.length || teamBNets.length < teamBIds.length) return scores;

      const bestA = Math.min(...teamANets);
      const bestB = Math.min(...teamBNets);
      const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';
      const status = computeMatchStatus(
        { ...holeData, [holeNum]: { holeWinner: winner } },
        teamAIds,
        teamBIds
      );
      return { ...scores, holeWinner: winner, matchStatus: status };
    });
  }

  const matchStatus = (() => {
    if (isScramble) {
      let cumA = 0, cumB = 0, holesPlayed = 0;
      for (let h = 1; h <= holeCount; h++) {
        const hd = holeData[h];
        if (hd?.teamA?.gross == null || hd?.teamB?.gross == null) break;
        cumA += hd.teamA.gross;
        cumB += hd.teamB.gross;
        holesPlayed++;
      }
      if (holesPlayed === 0) return '⛳ Scramble';
      const diff = cumA - cumB;
      if (diff === 0) return `⛳ Tied thru ${holesPlayed}`;
      const margin = Math.abs(diff);
      const leadTeam = diff < 0 ? 'teamA' : 'teamB';
      const leadName = tournament?.[leadTeam]?.name ?? leadTeam;
      return `⛳ ${leadName} leads by ${margin} thru ${holesPlayed}`;
    }
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

  // Scramble scorecard: Hole | Team A gross | Team B gross | running stroke diff
  function renderScrambleScorecard() {
    const teamAName = tournament?.teamA?.name || 'Team A';
    const teamBName = tournament?.teamB?.name || 'Team B';
    const gridStyle = { gridTemplateColumns: '28px 1fr 1fr 40px' };

    let cumA = 0, cumB = 0;
    for (let h = 1; h <= holeCount; h++) {
      const hd = holeData[h];
      if (hd?.teamA?.gross != null) cumA += hd.teamA.gross;
      if (hd?.teamB?.gross != null) cumB += hd.teamB.gross;
    }
    const totalDiff = cumA - cumB;

    return (
      <div className={styles.scorecardGrid}>
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          <span style={{ textAlign: 'center', color: 'var(--teamA)', fontWeight: 700, fontSize: '13px' }}>{teamAName}</span>
          <span style={{ textAlign: 'center', color: 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>{teamBName}</span>
          <span />
        </div>

        {Array.from({ length: holeCount }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const holePar = courseHoles[h]?.par;

          // Running cumulative diff through this hole
          let runA = 0, runB = 0;
          for (let hh = 1; hh <= h; hh++) {
            const hhd = holeData[hh];
            if (hhd?.teamA?.gross != null) runA += hhd.teamA.gross;
            if (hhd?.teamB?.gross != null) runB += hhd.teamB.gross;
          }
          const holePlayed = hd.teamA?.gross != null && hd.teamB?.gross != null;
          const runDiff = runA - runB;
          const diffLabel = !holePlayed ? '' : runDiff === 0 ? 'E' : `${Math.abs(runDiff)} up`;
          const diffColor = !holePlayed ? 'var(--text-muted)'
            : runDiff < 0 ? 'var(--teamA)'
            : runDiff > 0 ? 'var(--teamB)'
            : 'var(--text-muted)';

          return (
            <div key={h} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {[hd.teamA, hd.teamB].map((score, idx) => (
                <span key={idx} className={styles.scScore}>
                  <span className={styles.dotSlot} />
                  <span className={`${styles.scorePill} ${ybScoreShape(score?.gross, holePar)}`}>
                    {score?.gross ?? '—'}
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
          <span className={styles.scHole} style={{ fontSize: 10 }}>⛳</span>
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

  // Fourball with segment scoring: Front 9 / Back 9 / Overall status strip
  function renderSegmentStrip() {
    const segDefs = [
      ['front', 'F9', 1, 9],
      ['back', 'B9', 10, 18],
      ['overall', '18', 1, 18],
    ];
    return (
      <div style={{ display: 'flex', gap: 8, margin: '0 0 12px' }}>
        {segDefs.map(([key, label, startH, endH]) => {
          const pts = round.segmentPoints?.[key] ?? 0;
          let diff = 0, played = 0;
          for (let h = startH; h <= endH; h++) {
            const hw = holeData[h]?.holeWinner;
            if (!hw) continue;
            played++;
            if (hw === 'teamA') diff++;
            else if (hw === 'teamB') diff--;
          }
          const team = diff > 0 ? 'teamA' : diff < 0 ? 'teamB' : null;
          const statusText = played === 0 ? '—' : diff === 0 ? 'AS' : `${
            match[team]?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join('/') ?? team
          } ${Math.abs(diff)}UP`;
          return (
            <div
              key={key}
              style={{
                flex: 1, textAlign: 'center', padding: '8px 4px',
                background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 10,
              }}
            >
              <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)' }}>
                {label} · {pts} pt{pts !== 1 ? 's' : ''}
              </div>
              <div style={{ fontSize: 12, fontWeight: 700, marginTop: 3, color: team ? `var(--${team})` : 'var(--text-muted)' }}>
                {statusText}
              </div>
            </div>
          );
        })}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/leaderboard')}>‹ Leaderboard</button>
        <div className={styles.matchStatus}>{matchStatus}</div>
      </div>

      {/* Teams */}
      <div className={styles.teams}>
        <div className={`${styles.teamPill} ${styles.teamA}`}>
          {(isYellowBall || isScramble) ? (tournament?.teamA?.name || 'Team A') : match.teamA?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
        <div className={styles.vsLabel}>vs</div>
        <div className={`${styles.teamPill} ${styles.teamB}`}>
          {(isYellowBall || isScramble) ? (tournament?.teamB?.name || 'Team B') : match.teamB?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
      </div>

      {/* Hole selector */}
      <div className={styles.holeNav}>
        {Array.from({ length: holeCount }, (_, i) => i + 1).map((h) => {
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

      {/* Staged notice — pairings are set but the round hasn't started */}
      {match.status === 'staged' && (
        <div className={styles.resultBanner}>
          Pairings are set — scoring opens when the round starts
        </div>
      )}

      {/* Score entry */}
      {isMyMatch && !roundComplete && matchLive && (
        <div className={styles.entryCard}>
          {/* Admin: player/pair picker; or player label for non-admin */}
          {isAdmin && isTeamEntry ? (
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
          ) : isScramble ? (
            <div className={styles.entryLabel}>
              Team score — {tournament?.[myTeam]?.name || myTeam}
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
              {net !== null && !isYellowBall && !isScramble && (
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

          {syncState && !justSaved && (
            <div className={`${styles.syncIndicator} ${
              syncState === 'saving' ? styles.syncSaving
              : syncState === 'synced' ? styles.syncSynced
              : styles.syncPending
            }`}>
              {syncState === 'saving' ? '↑ Saving…'
               : syncState === 'synced' ? '✓ Synced'
               : `Offline · ${syncState.pending} pending`}
            </div>
          )}

          {justSaved ? (
            <div className={styles.savedBanner}>✓ Saved!</div>
          ) : (
            <button
              className={styles.submitBtn}
              onClick={submitHole}
              disabled={!gross || (isAdmin && !effectivePlayerId)}
            >
              {isScramble
                ? `Save Team Score — Hole ${currentHole}`
                : isFoursomes
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
                {isFoursomes || isYellowBall || isScramble
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
          skinsBets={skinsBets}
          match={match}
          allPlayerIds={allPlayerIds}
          playerId={playerId}
          isAdmin={isAdmin}
        />
      )}

      {/* Scorecard */}
      {matchTab === 'scorecard' && (
      <div className={styles.scorecard}>
        <div className={styles.sectionLabel}>Scorecard</div>

        {match.format === 'fourball' && round?.segmentPoints && renderSegmentStrip()}

        {isScramble ? renderScrambleScorecard() : isFoursomes ? renderFoursomesScorecard() : isYellowBall ? (
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
