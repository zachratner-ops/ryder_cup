import { useEffect, useState, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { ref, onValue, push, update } from 'firebase/database';
import { db } from '../firebase';
import {
  computeNassauStatus,
  computeNassauPayout,
  computeSegmentStatus,
  computePressPayout,
  formatSegmentStatus,
  DEFAULT_COMPONENTS,
} from '../nassauCompute';
import { computeSkinsResult } from '../skinsCompute';
import SkinsBetCard from '../components/SkinsBetCard';
import styles from './Bets.module.css';

// ── helpers ─────────────────────────────────────────────────────────────────

function firstName(players, id) {
  return players[id]?.name?.split(' ')[0] || id;
}

function teamColor(players, id) {
  return players[id]?.teamId === 'teamA' ? 'var(--teamA)' : 'var(--teamB)';
}

function fmtMoney(n) {
  if (n === 0) return 'Even';
  const abs = Math.abs(n);
  const str = Number.isInteger(abs) ? `$${abs}` : `$${abs.toFixed(2)}`;
  return n > 0 ? `+${str}` : `-${str}`;
}

const SEG_LABELS = { front: 'Front 9', back: 'Back 9', overall: 'Overall' };

// Backward-compat helpers for custom bets (old schema: playerA/playerB/winner, new: players[]/winners[])
function getBetPlayerIds(bet) {
  if (Array.isArray(bet.players)) return bet.players;
  return [bet.playerA, bet.playerB].filter(Boolean);
}

function getBetWinnerIds(bet) {
  if (bet.status !== 'settled') return null;
  if (Array.isArray(bet.winners)) return bet.winners;
  // old schema
  const allPlayers = getBetPlayerIds(bet);
  if (bet.winner === 'half') return allPlayers;
  if (bet.winner) return [bet.winner];
  return null;
}

// ── Press rows (nested under a Nassau segment row, recursive for sub-presses) ──

function PressRows({ presses, nassauBet, nassauBetId, holeData, players, allPresses, playerId }) {
  if (!presses.length) return null;

  return (
    <div className={styles.pressRows}>
      {presses.map(([pressId, press]) => {
        const { startHole, endHole } = press;
        const status = computeSegmentStatus(holeData, nassauBet, startHole, endHole);
        const label = `Press ${startHole}–${endHole}`;
        const decided = status.winner !== 'incomplete';

        const is2v2Press = nassauBet.mode === '2v2';
        const nameA = is2v2Press
          ? (nassauBet.teamAIds || []).map(id => firstName(players, id)).join(' & ')
          : firstName(players, nassauBet.playerA);
        const nameB = is2v2Press
          ? (nassauBet.teamBIds || []).map(id => firstName(players, id)).join(' & ')
          : firstName(players, nassauBet.playerB);
        const statusStr = formatSegmentStatus(status, nameA, nameB, startHole, endHole);

        const winnerName = status.winner === 'playerA' ? nameA : status.winner === 'playerB' ? nameB : null;
        const loserName = status.winner === 'playerA' ? nameB : status.winner === 'playerB' ? nameA : null;

        // Find any sub-presses whose parent is this press
        const childPresses = allPresses
          ? Object.entries(allPresses).filter(
              ([, p]) => p.nassauBetId === nassauBetId && p.parentPressId === pressId
            )
          : [];

        return (
          <div key={pressId}>
            <div className={styles.pressRow}>
              <span className={styles.pressLabel}>{label}</span>
              <span className={`${styles.pressStatus} ${decided && status.winner !== 'half' ? styles.pressStatusDecided : ''}`}>
                {statusStr}
              </span>
              {decided && (
                <div className={styles.pressPayout}>
                  {status.winner === 'half' ? (
                    <span className={styles.pressPayoutHalved}>Halved</span>
                  ) : (
                    <>
                      <span className={styles.pressPayoutWinner}>{winnerName} +${nassauBet.amount}</span>
                      <span className={styles.pressPayoutLoser}>{loserName} -${nassauBet.amount}</span>
                    </>
                  )}
                </div>
              )}
            </div>
            {childPresses.length > 0 && (
              <PressRows
                presses={childPresses}
                nassauBet={nassauBet}
                nassauBetId={nassauBetId}
                holeData={holeData}
                players={players}
                allPresses={allPresses}
                playerId={playerId}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Nassau bet card ──────────────────────────────────────────────────────────

function NassauBetCard({ betId, bet, holeData, players, allPresses, playerId, matches, rounds }) {
  const componentStatuses = computeNassauStatus(holeData, bet);
  const is2v2 = bet.mode === '2v2';
  const nameA = is2v2
    ? (bet.teamAIds || []).map(id => firstName(players, id)).join(' & ')
    : firstName(players, bet.playerA);
  const nameB = is2v2
    ? (bet.teamBIds || []).map(id => firstName(players, id)).join(' & ')
    : firstName(players, bet.playerB);
  const colorA = is2v2 ? 'var(--teamA)' : teamColor(players, bet.playerA);
  const colorB = is2v2 ? 'var(--teamB)' : teamColor(players, bet.playerB);

  const isViewerA = !is2v2 && playerId === bet.playerA;
  const isViewerB = !is2v2 && playerId === bet.playerB;
  const isViewer = is2v2
    ? [...(bet.teamAIds || []), ...(bet.teamBIds || [])].includes(playerId)
    : isViewerA || isViewerB;

  // Match / round info for the header link
  const match = matches && bet.matchId ? matches[bet.matchId] : null;
  const round = match && rounds ? rounds[match.roundId] : null;
  const roundNum = round?.order ?? '?';
  const formatLabel = FORMAT_LABEL[match?.format] || match?.format || 'Match';

  // Collect top-level presses for this bet grouped by component label
  const pressesByLabel = {};
  Object.entries(allPresses).forEach(([pid, p]) => {
    if (p.nassauBetId === betId && p.parentPressId == null) {
      const key = p.segment || p.label || '';
      if (!pressesByLabel[key]) pressesByLabel[key] = [];
      pressesByLabel[key].push([pid, p]);
    }
  });

  return (
    <div className={styles.nassauCard}>
      <div className={styles.nassauHeader}>
        <div className={styles.nassauHeaderLeft}>
          <div className={styles.nassauPlayers}>
            <span style={{ color: colorA }}>{nameA}</span>
            <span className={styles.vsText}>vs</span>
            <span style={{ color: colorB }}>{nameB}</span>
          </div>
          {match && (
            <Link to={`/match/${bet.matchId}`} className={styles.nassauMatchLink}>
              Round {roundNum}: {formatLabel}
            </Link>
          )}
        </div>
        <div className={styles.nassauMeta}>${bet.amount}/comp</div>
      </div>

      <div className={styles.nassauSegments}>
        {componentStatuses.map(({ label, startHole, endHole, status: s }) => {
          const statusStr = formatSegmentStatus(s, nameA, nameB, startHole, endHole);
          const decided = s.winner !== 'incomplete';

          const winnerName =
            s.winner === 'playerA' ? nameA :
            s.winner === 'playerB' ? nameB : null;
          const loserName =
            s.winner === 'playerA' ? nameB :
            s.winner === 'playerB' ? nameA : null;

          // Block: only accent left-bar while in progress; no tinting when decided
          const blockMod = !decided && s.holesPlayed > 0 ? styles.segBlockInProgress : '';

          return (
            <div key={label} className={`${styles.segBlock} ${blockMod}`}>
              <div className={styles.segBlockHeader}>
                <span className={styles.segLabel}>{label}</span>
              </div>
              <div className={styles.segStatusRow}>
                <span
                  className={`${styles.segStatus} ${
                    decided && s.winner !== 'half' ? styles.segStatusWon :
                    s.holesPlayed === 0 ? styles.segStatusMuted : ''
                  }`}
                >
                  {statusStr}
                </span>
                {decided && s.winner !== 'half' && (
                  <div className={styles.segPayoutLines}>
                    <span className={styles.segPayoutWinner}>{winnerName} +${bet.amount}</span>
                    <span className={styles.segPayoutLoser}>{loserName} -${bet.amount}</span>
                  </div>
                )}
                {decided && s.winner === 'half' && (
                  <span className={styles.segPayoutHalved}>Halved — no money</span>
                )}
              </div>
              <PressRows
                presses={pressesByLabel[label] || []}
                nassauBet={bet}
                nassauBetId={betId}
                holeData={holeData}
                players={players}
                allPresses={allPresses}
                playerId={playerId}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Custom bet card ──────────────────────────────────────────────────────────

function CustomBetCard({ betId, bet, players, onSettle }) {
  const betPlayerIds = getBetPlayerIds(bet);
  const winnerIds = getBetWinnerIds(bet);

  // settled label
  let settledLabel = null;
  if (winnerIds) {
    const allTied = winnerIds.length === betPlayerIds.length;
    settledLabel = allTied
      ? 'Halved'
      : winnerIds.map(pid => firstName(players, pid)).join(' & ') + ' wins';
  }

  return (
    <div className={styles.customCard}>
      <div className={styles.customHeader}>
        <span className={styles.customDesc}>{bet.description}</span>
        <span className={styles.customAmount}>${bet.amount}</span>
      </div>
      <div className={styles.customFooter}>
        <span className={styles.customPlayers}>
          {betPlayerIds.map((pid, i) => (
            <span key={pid}>
              {i > 0 && <span style={{ color: 'var(--text-muted)' }}> · </span>}
              <span style={{ color: teamColor(players, pid), fontWeight: 700 }}>
                {firstName(players, pid)}
              </span>
            </span>
          ))}
        </span>
        {bet.status === 'settled' ? (
          <span className={`${styles.customStatus} ${styles.statusSettled}`}>
            {settledLabel}
          </span>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <span className={`${styles.customStatus} ${styles.statusOpen}`}>Open</span>
            <button className={styles.settleBtn} onClick={() => onSettle(betId, bet)}>Settle</button>
          </div>
        )}
      </div>
    </div>
  );
}



// ── Skins create form (rendered inside the modal) ───────────────────────────

function SkinsCreateForm({ players, matches, rounds, playerId, onClose }) {
  const [matchId, setMatchId] = useState('');
  const [selectedPlayers, setSelectedPlayers] = useState([]);
  const [amount, setAmount] = useState('');
  const [startHole, setStartHole] = useState('1');
  const [endHole, setEndHole] = useState('18');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const activeMatches = Object.entries(matches)
    .filter(([, m]) => m.status !== 'complete')
    .sort(([, a], [, b]) => (rounds[a.roundId]?.order ?? 99) - (rounds[b.roundId]?.order ?? 99));

  function handleMatchChange(mid) {
    setMatchId(mid);
    if (!mid || !matches[mid]) { setSelectedPlayers([]); return; }
    const m = matches[mid];
    const allIds = [...(m.teamA?.playerIds || []), ...(m.teamB?.playerIds || [])];
    setSelectedPlayers(allIds);
  }

  function togglePlayer(pid) {
    setSelectedPlayers(prev =>
      prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
    );
  }

  async function handleCreate() {
    if (!matchId) { setError('Select a match.'); return; }
    if (selectedPlayers.length < 2) { setError('Select at least 2 players.'); return; }
    if (!amount || parseFloat(amount) <= 0) { setError('Enter a dollar amount per skin.'); return; }
    const s = parseInt(startHole), e = parseInt(endHole);
    if (!s || !e || s < 1 || e > 18 || s >= e) { setError('Enter a valid hole range (start < end, 1–18).'); return; }
    setLoading(true);
    setError('');
    try {
      await push(ref(db, 'skinsBets'), {
        matchId,
        players: selectedPlayers,
        amount: parseFloat(amount),
        startHole: s,
        endHole: e,
        createdBy: playerId || 'unknown',
        createdAt: Date.now(),
        status: 'open',
      });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const playersInMatch = matchId && matches[matchId]
    ? [...(matches[matchId].teamA?.playerIds || []), ...(matches[matchId].teamB?.playerIds || [])]
    : [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Match</label>
        <select className={styles.formInput} value={matchId} onChange={e => handleMatchChange(e.target.value)}>
          <option value="">Select a match…</option>
          {activeMatches.map(([mid, m]) => {
            const r = rounds[m.roundId];
            const allIds = [...(m.teamA?.playerIds || []), ...(m.teamB?.playerIds || [])];
            const names = allIds.map(id => players[id]?.name?.split(' ')[0] || id).join(', ');
            return <option key={mid} value={mid}>Round {r?.order ?? '?'} — {names}</option>;
          })}
        </select>
      </div>

      {playersInMatch.length > 0 && (
        <div className={styles.formGroup}>
          <label className={styles.formLabel}>Players competing</label>
          <div className={styles.compCheckboxes}>
            {playersInMatch.map(pid => (
              <button
                key={pid}
                type="button"
                className={`${styles.compBtn} ${selectedPlayers.includes(pid) ? styles.compBtnOn : ''}`}
                onClick={() => togglePlayer(pid)}
              >
                {firstName(players, pid)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>Hole range</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <input
            className={styles.formInput}
            type="number" min="1" max="17" placeholder="Start"
            value={startHole} onChange={e => setStartHole(e.target.value)}
            style={{ flex: 1 }}
          />
          <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>–</span>
          <input
            className={styles.formInput}
            type="number" min="2" max="18" placeholder="End"
            value={endHole} onChange={e => setEndHole(e.target.value)}
            style={{ flex: 1 }}
          />
        </div>
      </div>

      <div className={styles.formGroup}>
        <label className={styles.formLabel}>$ Per skin</label>
        <input
          className={styles.formInput}
          type="number" min="1" step="1" placeholder="e.g. 5"
          value={amount} onChange={e => setAmount(e.target.value)}
        />
      </div>

      {error && <p style={{ color: '#dc2626', fontSize: 14, margin: 0 }}>{error}</p>}

      <button className={styles.submitBtn} onClick={handleCreate} disabled={loading}>
        {loading ? 'Creating…' : 'Create Skins Bet'}
      </button>
    </div>
  );
}

// ── Create bet modal ─────────────────────────────────────────────────────────

const FORMAT_LABEL = {
  fourball: 'Four-Ball',
  foursomes: 'Foursomes',
  singles: 'Singles',
  yellowball: 'Yellow Ball',
};

function CreateBetModal({ players, matches, rounds, playerId, onClose, onCreated }) {
  const [tab, setTab] = useState('nassau');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Nassau form state
  const [nassauMatchId, setNassauMatchId] = useState('');
  const [nassauPlayerA, setNassauPlayerA] = useState(playerId || '');
  const [nassauPlayerB, setNassauPlayerB] = useState('');
  const [nassauAmount, setNassauAmount] = useState('');
  // Component selection: which of front9/back9/overall are active + optional custom
  const [compFront, setCompFront] = useState(true);
  const [compBack, setCompBack] = useState(true);
  const [compOverall, setCompOverall] = useState(true);
  const [compCustom, setCompCustom] = useState(false);
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');

  // Custom form state
  const [customDesc, setCustomDesc] = useState('');
  const [customPlayerIds, setCustomPlayerIds] = useState(playerId ? [playerId] : []);
  const [customAmount, setCustomAmount] = useState('');

  function toggleCustomPlayer(id) {
    setCustomPlayerIds(prev => prev.includes(id) ? prev.filter(p => p !== id) : [...prev, id]);
  }

  // Show active/upcoming (not completed) matches
  const activeMatches = Object.entries(matches)
    .filter(([, m]) => m.status !== 'complete')
    .sort(([, a], [, b]) => {
      const rA = rounds[a.roundId]?.order ?? 99;
      const rB = rounds[b.roundId]?.order ?? 99;
      return rA - rB;
    });

  const playersInMatch = useMemo(() => {
    if (!nassauMatchId || !matches[nassauMatchId]) return [];
    const m = matches[nassauMatchId];
    return [...(m.teamA?.playerIds || []), ...(m.teamB?.playerIds || [])];
  }, [nassauMatchId, matches]);

  const allPlayerList = Object.entries(players).sort(([, a], [, b]) => a.name.localeCompare(b.name));

  async function handleCreateNassau() {
    if (!nassauMatchId || !nassauPlayerA || !nassauPlayerB || !nassauAmount) {
      setError('Fill in all fields.');
      return;
    }
    if (nassauPlayerA === nassauPlayerB) {
      setError('Pick two different players.');
      return;
    }
    // Build components array from selections
    const components = [];
    if (compFront) components.push({ label: 'Front 9', startHole: 1, endHole: 9 });
    if (compBack) components.push({ label: 'Back 9', startHole: 10, endHole: 18 });
    if (compOverall) components.push({ label: 'Overall', startHole: 1, endHole: 18 });
    if (compCustom) {
      const s = parseInt(customStart), e = parseInt(customEnd);
      if (!s || !e || s < 1 || e > 18 || s >= e) { setError('Custom range must be valid holes (1–18, start < end).'); return; }
      components.push({ label: `Holes ${s}–${e}`, startHole: s, endHole: e });
    }
    if (components.length === 0) { setError('Select at least one component.'); return; }

    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/bets/nassau', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          matchId: nassauMatchId,
          playerA: nassauPlayerA,
          playerB: nassauPlayerB,
          amount: parseFloat(nassauAmount),
          components,
          createdBy: playerId || 'unknown',
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to create bet');
      onCreated();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleCreateCustom() {
    if (!customDesc.trim() || !customAmount) {
      setError('Fill in all fields.');
      return;
    }
    if (customPlayerIds.length < 2) {
      setError('Select at least two players.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await push(ref(db, 'customBets'), {
        description: customDesc.trim(),
        players: customPlayerIds,
        amount: parseFloat(customAmount),
        winners: null,
        createdBy: playerId || 'unknown',
        createdAt: Date.now(),
        status: 'open',
        settledBy: null,
        settledAt: null,
      });
      onCreated();
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHandle} />
        <div className={styles.sheetTitle}>New Side Bet</div>

        <div className={styles.modalTabs}>
          <button
            className={`${styles.modalTabBtn} ${tab === 'nassau' ? styles.modalTabActive : ''}`}
            onClick={() => { setTab('nassau'); setError(''); }}
          >
            Nassau
          </button>
          <button
            className={`${styles.modalTabBtn} ${tab === 'skins' ? styles.modalTabActive : ''}`}
            onClick={() => { setTab('skins'); setError(''); }}
          >
            Skins
          </button>
          <button
            className={`${styles.modalTabBtn} ${tab === 'custom' ? styles.modalTabActive : ''}`}
            onClick={() => { setTab('custom'); setError(''); }}
          >
            Custom
          </button>
        </div>

        {tab === 'nassau' && (
          <>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Match</label>
              <select
                className={styles.formInput}
                value={nassauMatchId}
                onChange={(e) => { setNassauMatchId(e.target.value); setNassauPlayerA(playerId || ''); setNassauPlayerB(''); }}
              >
                <option value="">Select a match…</option>
                {activeMatches.map(([mid, m]) => {
                  const round = rounds[m.roundId];
                  const roundNum = round?.order ?? '?';
                  const fmt = FORMAT_LABEL[m.format] || m.format || 'Match';
                  const allIds = [...(m.teamA?.playerIds || []), ...(m.teamB?.playerIds || [])];
                  const playerNames = allIds.map(id => players[id]?.name?.split(' ')[0] || id).join(', ');
                  return <option key={mid} value={mid}>Round {roundNum} · {fmt} — {playerNames}</option>;
                })}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Player A (you)</label>
              <select
                className={styles.formInput}
                value={nassauPlayerA}
                onChange={(e) => setNassauPlayerA(e.target.value)}
                disabled={!nassauMatchId}
              >
                <option value="">Select player…</option>
                {playersInMatch.filter(id => id !== nassauPlayerB).map(id => (
                  <option key={id} value={id}>{players[id]?.name || id}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Player B (opponent)</label>
              <select
                className={styles.formInput}
                value={nassauPlayerB}
                onChange={(e) => setNassauPlayerB(e.target.value)}
                disabled={!nassauMatchId}
              >
                <option value="">Select player…</option>
                {playersInMatch.filter(id => id !== nassauPlayerA).map(id => (
                  <option key={id} value={id}>{players[id]?.name || id}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Components</label>
              <div className={styles.compCheckboxes}>
                {[
                  { key: 'front', label: 'Front 9', val: compFront, set: setCompFront },
                  { key: 'back', label: 'Back 9', val: compBack, set: setCompBack },
                  { key: 'overall', label: 'Overall', val: compOverall, set: setCompOverall },
                  { key: 'custom', label: 'Custom', val: compCustom, set: setCompCustom },
                ].map(({ key, label, val, set }) => (
                  <button
                    key={key}
                    type="button"
                    className={`${styles.compBtn} ${val ? styles.compBtnOn : ''}`}
                    onClick={() => set(v => !v)}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {compCustom && (
                <div className={styles.customRangeRow}>
                  <input
                    className={styles.formInput}
                    type="number" min="1" max="17" placeholder="Start hole"
                    value={customStart} onChange={e => setCustomStart(e.target.value)}
                    style={{ flex: 1 }}
                  />
                  <span style={{ color: 'var(--text-muted)', fontWeight: 600, padding: '0 6px' }}>–</span>
                  <input
                    className={styles.formInput}
                    type="number" min="2" max="18" placeholder="End hole"
                    value={customEnd} onChange={e => setCustomEnd(e.target.value)}
                    style={{ flex: 1 }}
                  />
                </div>
              )}
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>$ Per Component</label>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 5"
                value={nassauAmount}
                onChange={(e) => setNassauAmount(e.target.value)}
              />
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 10 }}>{error}</p>}
            <button className={styles.submitBtn} onClick={handleCreateNassau} disabled={loading}>
              {loading ? 'Creating…' : 'Create Nassau Bet'}
            </button>
          </>
        )}

        {tab === 'skins' && (
          <SkinsCreateForm
            players={players}
            matches={matches}
            rounds={rounds}
            playerId={playerId}
            onClose={onClose}
          />
        )}

        {tab === 'custom' && (
          <>
            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Bet Description</label>
              <input
                className={styles.formInput}
                type="text"
                placeholder="e.g. First birdie of the day"
                value={customDesc}
                onChange={(e) => setCustomDesc(e.target.value)}
              />
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Players (select all involved)</label>
              <div className={styles.compCheckboxes}>
                {allPlayerList.map(([id, p]) => (
                  <button
                    key={id}
                    type="button"
                    className={`${styles.compBtn} ${customPlayerIds.includes(id) ? styles.compBtnOn : ''}`}
                    onClick={() => toggleCustomPlayer(id)}
                  >
                    {p.name?.split(' ')[0] || p.name}
                  </button>
                ))}
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>$ Amount (per person)</label>
              <input
                className={styles.formInput}
                type="number"
                min="0"
                step="1"
                placeholder="e.g. 10"
                value={customAmount}
                onChange={(e) => setCustomAmount(e.target.value)}
              />
            </div>

            {error && <p style={{ color: '#dc2626', fontSize: 14, marginBottom: 10 }}>{error}</p>}
            <button className={styles.submitBtn} onClick={handleCreateCustom} disabled={loading}>
              {loading ? 'Creating…' : 'Create Custom Bet'}
            </button>
          </>
        )}

        <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Settle modal ─────────────────────────────────────────────────────────────

function SettleModal({ betId, bet, players, playerId, onClose }) {
  const betPlayerIds = getBetPlayerIds(bet);
  const [selectedWinners, setSelectedWinners] = useState([]);
  const [loading, setLoading] = useState(false);

  function toggleWinner(pid) {
    setSelectedWinners(prev =>
      prev.includes(pid) ? prev.filter(p => p !== pid) : [...prev, pid]
    );
  }

  function selectAll() {
    setSelectedWinners([...betPlayerIds]);
  }

  async function handleSettle() {
    if (!selectedWinners.length) return;
    setLoading(true);
    const allTied = selectedWinners.length === betPlayerIds.length;
    try {
      await update(ref(db, `customBets/${betId}`), {
        winners: selectedWinners,
        // legacy compat field
        winner: allTied ? 'half' : selectedWinners[0],
        status: 'settled',
        settledBy: playerId || 'unknown',
        settledAt: Date.now(),
      });
      onClose();
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  const losers = betPlayerIds.filter(pid => !selectedWinners.includes(pid));
  const winAmt = losers.length > 0 && selectedWinners.length > 0
    ? (bet.amount * losers.length / selectedWinners.length)
    : 0;

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHandle} />
        <div className={styles.sheetTitle}>Settle Bet</div>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 4 }}>{bet.description}</p>
        <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
          Tap who won. Select all to mark as a push.
        </p>

        <div className={styles.compCheckboxes} style={{ marginBottom: 16 }}>
          {betPlayerIds.map(pid => (
            <button
              key={pid}
              type="button"
              className={`${styles.compBtn} ${selectedWinners.includes(pid) ? styles.compBtnOn : ''}`}
              onClick={() => toggleWinner(pid)}
            >
              {firstName(players, pid)}
            </button>
          ))}
        </div>

        {/* Push shortcut */}
        {betPlayerIds.length > 2 && (
          <button
            type="button"
            style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, fontWeight: 600, marginBottom: 16, cursor: 'pointer', padding: 0 }}
            onClick={selectAll}
          >
            Mark all as push →
          </button>
        )}

        {/* Preview */}
        {selectedWinners.length > 0 && losers.length > 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>
            {selectedWinners.map(pid => firstName(players, pid)).join(' & ')} each collect{' '}
            <strong style={{ color: 'var(--green)' }}>
              ${Number.isInteger(winAmt) ? winAmt : winAmt.toFixed(2)}
            </strong>
            {' · '}
            {losers.map(pid => firstName(players, pid)).join(' & ')} each pay{' '}
            <strong style={{ color: '#dc2626' }}>${bet.amount}</strong>
          </p>
        )}
        {selectedWinners.length > 0 && losers.length === 0 && (
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 14 }}>Push — no money changes hands.</p>
        )}

        <button className={styles.submitBtn} onClick={handleSettle} disabled={!selectedWinners.length || loading}>
          {loading ? 'Saving…' : 'Confirm Settlement'}
        </button>
        <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
      </div>
    </div>
  );
}

// ── Main Bets page ───────────────────────────────────────────────────────────

export default function Bets({ playerId }) {
  const [nassauBets, setNassauBets] = useState({});
  const [customBets, setCustomBets] = useState({});
  const [skinsBets, setSkinsBets] = useState({});
  const [presses, setPresses] = useState({});
  const [players, setPlayers] = useState({});
  const [matches, setMatches] = useState({});
  const [rounds, setRounds] = useState({});
  const [allHoles, setAllHoles] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [settlingBet, setSettlingBet] = useState(null); // { betId, bet }

  useEffect(() => {
    const u1 = onValue(ref(db, 'nassauBets'), (s) => setNassauBets(s.val() || {}));
    const u2 = onValue(ref(db, 'customBets'), (s) => setCustomBets(s.val() || {}));
    const u3 = onValue(ref(db, 'skinsBets'), (s) => setSkinsBets(s.val() || {}));
    const u4 = onValue(ref(db, 'presses'), (s) => setPresses(s.val() || {}));
    const u5 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u6 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    const u7 = onValue(ref(db, 'holes'), (s) => setAllHoles(s.val() || {}));
    const u8 = onValue(ref(db, 'rounds'), (s) => setRounds(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); u7(); u8(); };
  }, []);

  // Running balances across all bets
  const playerBalances = useMemo(() => {
    const balances = {};

    function apply2v2Payout(bet, deltaA, deltaB) {
      const aIds = bet.teamAIds || [];
      const bIds = bet.teamBIds || [];
      if (aIds.length) aIds.forEach(pid => { balances[pid] = (balances[pid] || 0) + deltaA / aIds.length; });
      if (bIds.length) bIds.forEach(pid => { balances[pid] = (balances[pid] || 0) + deltaB / bIds.length; });
    }

    // Nassau bets
    Object.entries(nassauBets).forEach(([betId, bet]) => {
      const holeData = allHoles[bet.matchId] || {};
      const status = computeNassauStatus(holeData, bet);
      const payout = computeNassauPayout(status, bet);
      if (bet.mode === '2v2') {
        apply2v2Payout(bet, payout['teamA'] || 0, payout['teamB'] || 0);
      } else {
        Object.entries(payout).forEach(([pid, delta]) => {
          balances[pid] = (balances[pid] || 0) + delta;
        });
      }
    });

    // Presses
    Object.entries(presses).forEach(([, press]) => {
      const nassauBet = nassauBets[press.nassauBetId];
      if (!nassauBet) return;
      const holeData = allHoles[nassauBet.matchId] || {};
      const { startHole, endHole } = press;
      const status = computeSegmentStatus(holeData, nassauBet, startHole, endHole);
      const payout = computePressPayout(status, nassauBet);
      if (nassauBet.mode === '2v2') {
        apply2v2Payout(nassauBet, payout['teamA'] || 0, payout['teamB'] || 0);
      } else {
        Object.entries(payout).forEach(([pid, delta]) => {
          balances[pid] = (balances[pid] || 0) + delta;
        });
      }
    });

    // Skins bets
    Object.entries(skinsBets).forEach(([, bet]) => {
      const holeData = allHoles[bet.matchId] || {};
      const { payouts } = computeSkinsResult(holeData, bet.players || [], bet.amount, bet.startHole ?? 1, bet.endHole ?? 18);
      Object.entries(payouts).forEach(([pid, delta]) => {
        balances[pid] = (balances[pid] || 0) + delta;
      });
    });

    // Custom bets (settled only)
    Object.entries(customBets).forEach(([, bet]) => {
      if (bet.status !== 'settled') return;
      const allPlayers = getBetPlayerIds(bet);
      const winners = getBetWinnerIds(bet);
      if (!winners || !winners.length) return;
      const losers = allPlayers.filter(pid => !winners.includes(pid));
      if (losers.length === 0) return; // push — no money changes hands
      const winAmt = bet.amount * losers.length / winners.length;
      winners.forEach(pid => { balances[pid] = (balances[pid] || 0) + winAmt; });
      losers.forEach(pid => { balances[pid] = (balances[pid] || 0) - bet.amount; });
    });

    return Object.entries(balances)
      .filter(([pid]) => players[pid]) // only show known players
      .map(([pid, balance]) => ({ playerId: pid, balance }))
      .sort((a, b) => b.balance - a.balance);
  }, [nassauBets, customBets, skinsBets, presses, allHoles, players]);

  // Minimal cash transfers to settle all debts
  const settleUp = useMemo(() => {
    const cred = playerBalances.filter(p => p.balance > 0.01).map(p => ({ ...p }));
    const debt = playerBalances.filter(p => p.balance < -0.01).map(p => ({ ...p, balance: -p.balance }));
    cred.sort((a, b) => b.balance - a.balance);
    debt.sort((a, b) => b.balance - a.balance);
    const transfers = [];
    let ci = 0, di = 0;
    while (ci < cred.length && di < debt.length) {
      const amount = Math.min(cred[ci].balance, debt[di].balance);
      if (amount > 0.01) {
        transfers.push({ from: debt[di].playerId, to: cred[ci].playerId, amount });
      }
      cred[ci].balance -= amount;
      debt[di].balance -= amount;
      if (cred[ci].balance < 0.01) ci++;
      if (debt[di].balance < 0.01) di++;
    }
    return transfers;
  }, [playerBalances]);

  const nassauList = Object.entries(nassauBets).sort((a, b) => b[1].createdAt - a[1].createdAt);
  const skinsList  = Object.entries(skinsBets).sort((a, b) => b[1].createdAt - a[1].createdAt);
  const customList = Object.entries(customBets).sort((a, b) => b[1].createdAt - a[1].createdAt);

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Side Bets</h1>
        <button className={styles.newBetBtn} onClick={() => setShowCreate(true)}>+ New Bet</button>
      </div>

      {/* Running Balances */}
      {playerBalances.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Running Balances</div>
          <div className={styles.balanceCard}>
            {playerBalances.map(({ playerId: pid, balance }) => (
              <div key={pid} className={styles.balanceRow}>
                <span className={styles.balanceName} style={{ color: teamColor(players, pid) }}>
                  {players[pid]?.name || pid}
                </span>
                <span
                  className={`${styles.balanceAmount} ${
                    balance > 0 ? styles.balancePos : balance < 0 ? styles.balanceNeg : styles.balanceEven
                  }`}
                >
                  {balance === 0 ? 'Even' : balance > 0 ? `+$${balance}` : `-$${Math.abs(balance)}`}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Settle-up summary */}
      {settleUp.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Settle Up</div>
          <div className={styles.settleCard}>
            {settleUp.map(({ from, to, amount }, i) => {
              const amtStr = Number.isInteger(amount) ? `$${amount}` : `$${amount.toFixed(2)}`;
              return (
                <div key={i} className={styles.settleRow}>
                  <span style={{ color: teamColor(players, from), fontWeight: 700 }}>{firstName(players, from)}</span>
                  <span className={styles.settlePays}>pays</span>
                  <span style={{ color: teamColor(players, to), fontWeight: 700 }}>{firstName(players, to)}</span>
                  <span className={styles.settleAmount}>{amtStr}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Nassau Bets */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Nassau Bets</div>
        {nassauList.length === 0 ? (
          <div className={styles.emptyNote}>No Nassau bets yet</div>
        ) : (
          nassauList.map(([betId, bet]) => (
            <NassauBetCard
              key={betId}
              betId={betId}
              bet={bet}
              holeData={allHoles[bet.matchId] || {}}
              players={players}
              allPresses={presses}
              playerId={playerId}
              matches={matches}
              rounds={rounds}
            />
          ))
        )}
      </div>

      {/* Skins Bets */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Skins</div>
        {skinsList.length === 0 ? (
          <div className={styles.emptyNote}>No skins bets yet</div>
        ) : (
          skinsList.map(([betId, bet]) => (
            <SkinsBetCard
              key={betId}
              betId={betId}
              bet={bet}
              holeData={allHoles[bet.matchId] || {}}
              players={players}
              matches={matches}
              rounds={rounds}
            />
          ))
        )}
      </div>

      {/* Custom Bets */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Custom Bets</div>
        {customList.length === 0 ? (
          <div className={styles.emptyNote}>No custom bets yet</div>
        ) : (
          customList.map(([betId, bet]) => (
            <CustomBetCard
              key={betId}
              betId={betId}
              bet={bet}
              players={players}
              onSettle={(id, b) => setSettlingBet({ betId: id, bet: b })}
            />
          ))
        )}
      </div>

      {showCreate && (
        <CreateBetModal
          players={players}
          matches={matches}
          rounds={rounds}
          playerId={playerId}
          onClose={() => setShowCreate(false)}
          onCreated={() => {}}
        />
      )}

      {settlingBet && (
        <SettleModal
          betId={settlingBet.betId}
          bet={settlingBet.bet}
          players={players}
          playerId={playerId}
          onClose={() => setSettlingBet(null)}
        />
      )}
    </div>
  );
}
