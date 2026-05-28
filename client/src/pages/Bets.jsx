import { useEffect, useState, useMemo } from 'react';
import { ref, onValue, push, update } from 'firebase/database';
import { db } from '../firebase';
import {
  computeNassauStatus,
  computeNassauPayout,
  computeSegmentStatus,
  computePressPayout,
  segmentRange,
  formatSegmentStatus,
} from '../nassauCompute';
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

// ── Press rows (nested under a Nassau segment row) ───────────────────────────

function PressRows({ presses, nassauBet, holeData, players }) {
  if (!presses.length) return null;
  return (
    <div className={styles.pressRows}>
      {presses.map(([pressId, press]) => {
        const { startHole, endHole } = press;
        const status = computeSegmentStatus(holeData, nassauBet, startHole, endHole);
        const payout = computePressPayout(status, nassauBet);
        const aDelta = payout[nassauBet.playerA] || 0;
        const label = `Press ${startHole}–${endHole}`;

        const nameA = firstName(players, nassauBet.playerA);
        const nameB = firstName(players, nassauBet.playerB);
        const statusStr = formatSegmentStatus(status, nameA, nameB, startHole, endHole);

        return (
          <div key={pressId} className={styles.pressRow}>
            <span className={styles.pressLabel}>{label}</span>
            <span className={styles.pressStatus}>{statusStr}</span>
            {status.winner !== 'incomplete' && (
              <span
                className={styles.pressPayout}
                style={{ color: aDelta > 0 ? 'var(--green)' : aDelta < 0 ? '#dc2626' : 'var(--text-muted)' }}
              >
                {status.winner === 'half' ? 'Halved' : `${fmtMoney(Math.abs(nassauBet.amount))}`}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Nassau bet card ──────────────────────────────────────────────────────────

function NassauBetCard({ betId, bet, holeData, players, allPresses }) {
  const status = computeNassauStatus(holeData, bet);
  const payout = computeNassauPayout(status, bet);
  const nameA = firstName(players, bet.playerA);
  const nameB = firstName(players, bet.playerB);

  // Collect presses for this bet grouped by segment
  const pressesBySegment = { front: [], back: [], overall: [] };
  Object.entries(allPresses).forEach(([pid, p]) => {
    if (p.nassauBetId === betId && p.parentPressId == null) {
      if (pressesBySegment[p.segment]) pressesBySegment[p.segment].push([pid, p]);
    }
  });

  return (
    <div className={styles.nassauCard}>
      <div className={styles.nassauHeader}>
        <div className={styles.nassauPlayers}>
          <span style={{ color: teamColor(players, bet.playerA) }}>{nameA}</span>
          <span className={styles.vsText}>vs</span>
          <span style={{ color: teamColor(players, bet.playerB) }}>{nameB}</span>
        </div>
        <div className={styles.nassauMeta}>${bet.amount}/hole</div>
      </div>

      <div className={styles.nassauSegments}>
        {(['front', 'back', 'overall']).map((seg) => {
          const s = status[seg];
          const { startHole, endHole } = segmentRange(seg);
          const statusStr = formatSegmentStatus(s, nameA, nameB, startHole, endHole);
          const decided = s.winner !== 'incomplete';
          const aDelta = decided ? (s.winner === 'playerA' ? bet.amount : s.winner === 'playerB' ? -bet.amount : 0) : null;

          return (
            <div key={seg}>
              <div className={styles.segRow}>
                <span className={styles.segLabel}>{SEG_LABELS[seg]}</span>
                <span
                  className={`${styles.segStatus} ${
                    decided && s.winner !== 'half' ? styles.segStatusWon :
                    s.holesPlayed === 0 ? styles.segStatusMuted : ''
                  }`}
                >
                  {statusStr}
                </span>
                {decided && (
                  <span
                    className={styles.segPayout}
                    style={{ color: aDelta > 0 ? 'var(--green)' : aDelta < 0 ? '#dc2626' : 'var(--text-muted)' }}
                  >
                    {s.winner === 'half' ? 'Halved' : `$${bet.amount}`}
                  </span>
                )}
              </div>
              <PressRows
                presses={pressesBySegment[seg]}
                nassauBet={bet}
                holeData={holeData}
                players={players}
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
  const nameA = firstName(players, bet.playerA);
  const nameB = firstName(players, bet.playerB);
  const winnerName = bet.winner === 'half' ? 'Halved' : bet.winner ? firstName(players, bet.winner) : null;

  return (
    <div className={styles.customCard}>
      <div className={styles.customHeader}>
        <span className={styles.customDesc}>{bet.description}</span>
        <span className={styles.customAmount}>${bet.amount}</span>
      </div>
      <div className={styles.customFooter}>
        <span className={styles.customPlayers}>
          <span style={{ color: teamColor(players, bet.playerA), fontWeight: 700 }}>{nameA}</span>
          <span style={{ color: 'var(--text-muted)' }}> vs </span>
          <span style={{ color: teamColor(players, bet.playerB), fontWeight: 700 }}>{nameB}</span>
        </span>
        {bet.status === 'settled' ? (
          <span className={`${styles.customStatus} ${styles.statusSettled}`}>
            {winnerName} wins
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

// ── Create bet modal ─────────────────────────────────────────────────────────

function CreateBetModal({ players, matches, playerId, onClose, onCreated }) {
  const [tab, setTab] = useState('nassau');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  // Nassau form state
  const [nassauMatchId, setNassauMatchId] = useState('');
  const [nassauPlayerA, setNassauPlayerA] = useState(playerId || '');
  const [nassauPlayerB, setNassauPlayerB] = useState('');
  const [nassauAmount, setNassauAmount] = useState('');

  // Custom form state
  const [customDesc, setCustomDesc] = useState('');
  const [customPlayerA, setCustomPlayerA] = useState(playerId || '');
  const [customPlayerB, setCustomPlayerB] = useState('');
  const [customAmount, setCustomAmount] = useState('');

  const activeMatches = Object.entries(matches).filter(([, m]) => m.status === 'active' || m.status === 'complete');

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
    if (!customDesc.trim() || !customPlayerA || !customPlayerB || !customAmount) {
      setError('Fill in all fields.');
      return;
    }
    if (customPlayerA === customPlayerB) {
      setError('Pick two different players.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await push(ref(db, 'customBets'), {
        description: customDesc.trim(),
        playerA: customPlayerA,
        playerB: customPlayerB,
        amount: parseFloat(customAmount),
        winner: null,
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
                  const allIds = [...(m.teamA?.playerIds || []), ...(m.teamB?.playerIds || [])];
                  const label = allIds.map(id => players[id]?.name?.split(' ')[0] || id).join(', ');
                  return <option key={mid} value={mid}>{label}</option>;
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
              <label className={styles.formLabel}>$ Per Component (front/back/overall)</label>
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
              <label className={styles.formLabel}>Player A</label>
              <select
                className={styles.formInput}
                value={customPlayerA}
                onChange={(e) => setCustomPlayerA(e.target.value)}
              >
                <option value="">Select player…</option>
                {allPlayerList.filter(([id]) => id !== customPlayerB).map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>Player B</label>
              <select
                className={styles.formInput}
                value={customPlayerB}
                onChange={(e) => setCustomPlayerB(e.target.value)}
              >
                <option value="">Select player…</option>
                {allPlayerList.filter(([id]) => id !== customPlayerA).map(([id, p]) => (
                  <option key={id} value={id}>{p.name}</option>
                ))}
              </select>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.formLabel}>$ Amount</label>
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
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);

  async function handleSettle() {
    if (!selected) return;
    setLoading(true);
    try {
      await update(ref(db, `customBets/${betId}`), {
        winner: selected,
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

  const options = [
    { value: bet.playerA, label: `${firstName(players, bet.playerA)} wins` },
    { value: bet.playerB, label: `${firstName(players, bet.playerB)} wins` },
    { value: 'half', label: 'Halved / Push' },
  ];

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.sheet} onClick={(e) => e.stopPropagation()}>
        <div className={styles.sheetHandle} />
        <div className={styles.sheetTitle}>Settle Bet</div>
        <p style={{ fontSize: 15, color: 'var(--text-muted)', marginBottom: 16 }}>{bet.description}</p>

        <div className={styles.settleOptions}>
          {options.map((opt) => (
            <button
              key={opt.value}
              className={`${styles.settleOption} ${selected === opt.value ? styles.selected : ''}`}
              onClick={() => setSelected(opt.value)}
            >
              {opt.label}
            </button>
          ))}
        </div>

        <button className={styles.submitBtn} onClick={handleSettle} disabled={!selected || loading}>
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
  const [presses, setPresses] = useState({});
  const [players, setPlayers] = useState({});
  const [matches, setMatches] = useState({});
  const [allHoles, setAllHoles] = useState({});
  const [showCreate, setShowCreate] = useState(false);
  const [settlingBet, setSettlingBet] = useState(null); // { betId, bet }

  useEffect(() => {
    const u1 = onValue(ref(db, 'nassauBets'), (s) => setNassauBets(s.val() || {}));
    const u2 = onValue(ref(db, 'customBets'), (s) => setCustomBets(s.val() || {}));
    const u3 = onValue(ref(db, 'presses'), (s) => setPresses(s.val() || {}));
    const u4 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u5 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    const u6 = onValue(ref(db, 'holes'), (s) => setAllHoles(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  // Running balances across all bets
  const playerBalances = useMemo(() => {
    const balances = {};

    // Nassau bets
    Object.entries(nassauBets).forEach(([betId, bet]) => {
      const holeData = allHoles[bet.matchId] || {};
      const status = computeNassauStatus(holeData, bet);
      const payout = computeNassauPayout(status, bet);
      Object.entries(payout).forEach(([pid, delta]) => {
        balances[pid] = (balances[pid] || 0) + delta;
      });
    });

    // Presses
    Object.entries(presses).forEach(([, press]) => {
      const nassauBet = nassauBets[press.nassauBetId];
      if (!nassauBet) return;
      const holeData = allHoles[nassauBet.matchId] || {};
      const { startHole, endHole } = press;
      const status = computeSegmentStatus(holeData, nassauBet, startHole, endHole);
      const payout = computePressPayout(status, nassauBet);
      Object.entries(payout).forEach(([pid, delta]) => {
        balances[pid] = (balances[pid] || 0) + delta;
      });
    });

    // Custom bets (settled only)
    Object.entries(customBets).forEach(([, bet]) => {
      if (bet.status !== 'settled' || !bet.winner || bet.winner === 'half') return;
      const winner = bet.winner;
      const loser = winner === bet.playerA ? bet.playerB : bet.playerA;
      balances[winner] = (balances[winner] || 0) + bet.amount;
      balances[loser] = (balances[loser] || 0) - bet.amount;
    });

    return Object.entries(balances)
      .filter(([pid]) => players[pid]) // only show known players
      .map(([pid, balance]) => ({ playerId: pid, balance }))
      .sort((a, b) => b.balance - a.balance);
  }, [nassauBets, customBets, presses, allHoles, players]);

  const nassauList = Object.entries(nassauBets).sort((a, b) => b[1].createdAt - a[1].createdAt);
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
