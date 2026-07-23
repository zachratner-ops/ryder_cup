import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import {
  computeNassauStatus,
  computeNassauPayout,
  computeSegmentStatus,
  computePressPayout,
} from '../nassauCompute';
import styles from './History.module.css';

const FORMAT_LABELS = {
  fourball: 'Four-ball',
  foursomes: 'Foursomes',
  singles: 'Singles',
  yellowball: 'Yellow Ball',
  scramble: 'Scramble',
};

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

function fmt$(n) {
  if (n === 0) return 'Even';
  return (n > 0 ? '+' : '') + '$' + Math.abs(n);
}

// ── Hole dot strip ───────────────────────────────────────────────────────────

function HoleStrip({ holeResults, teamAColor, teamBColor }) {
  return (
    <div className={styles.holeStrip}>
      {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
        const w = holeResults?.[h]?.holeWinner;
        const cls = w === 'teamA' ? styles.dotA
          : w === 'teamB' ? styles.dotB
          : w === 'half' ? styles.dotHalf
          : styles.dotEmpty;
        return (
          <div key={h} className={`${styles.holeDot} ${cls}`}
            style={w === 'teamA' ? { background: teamAColor }
              : w === 'teamB' ? { background: teamBColor } : undefined}>
            <span className={styles.dotNum}>{h}</span>
          </div>
        );
      })}
    </div>
  );
}

// ── Betting totals ───────────────────────────────────────────────────────────

function BettingSection({ archive }) {
  const nassauBets = archive.nassauBets ? Object.entries(archive.nassauBets) : [];
  const customBets = archive.customBets ? Object.entries(archive.customBets) : [];
  const presses    = archive.presses    ? Object.values(archive.presses)     : [];

  if (!nassauBets.length && !customBets.length) return null;

  // Build matchId → holeResults lookup from the matches array
  const matchHoleData = {};
  (archive.matches || []).forEach((m) => {
    matchHoleData[m.matchId] = m.holeResults || {};
  });

  // Compute per-player net across all bets
  const balances = {};
  function addBalance(pid, delta) {
    balances[pid] = (balances[pid] || 0) + delta;
  }
  // 2v2 payouts are team-level; split each side's delta evenly among its members
  // Amount is per person: each team member is in for the full component amount.
  function apply2v2Payout(bet, deltaA, deltaB) {
    (bet.teamAIds || []).forEach((pid) => addBalance(pid, deltaA));
    (bet.teamBIds || []).forEach((pid) => addBalance(pid, deltaB));
  }

  // Nassau bets
  const nassauResults = nassauBets.map(([betId, bet]) => {
    const holeData = matchHoleData[bet.matchId] || {};
    const componentStatuses = computeNassauStatus(holeData, bet);
    const payout = computeNassauPayout(componentStatuses, bet);
    if (bet.mode === '2v2') apply2v2Payout(bet, payout['teamA'] || 0, payout['teamB'] || 0);
    else Object.entries(payout).forEach(([pid, delta]) => addBalance(pid, delta));

    // Presses for this bet
    const betPresses = presses.filter((p) => p.nassauBetId === betId && !p.parentPressId);
    const pressResults = betPresses.map((press) => {
      const ps = computeSegmentStatus(holeData, bet, press.startHole, press.endHole);
      const pp = computePressPayout(ps, bet);
      if (bet.mode === '2v2') apply2v2Payout(bet, pp['teamA'] || 0, pp['teamB'] || 0);
      else Object.entries(pp).forEach(([pid, delta]) => addBalance(pid, delta));
      return { press, status: ps, payout: pp };
    });

    return { betId, bet, componentStatuses, payout, pressResults };
  });

  // Custom bets
  const customResults = customBets.map(([betId, bet]) => {
    const players = bet.players || (bet.playerA ? [bet.playerA, bet.playerB] : []);
    const winners = bet.winners || (bet.winner ? [bet.winner] : []);
    if (bet.status === 'settled' && winners.length) {
      const losers = players.filter((p) => !winners.includes(p));
      if (losers.length > 0) {
        const winAmt = (bet.amount || 0) * losers.length / winners.length;
        winners.forEach((p) => addBalance(p, winAmt));
        losers.forEach((p) => addBalance(p, -(bet.amount || 0)));
      }
    }
    return { betId, bet, winners };
  });

  const players = archive.players || {};
  const firstName = (pid) => players[pid]?.name?.split(' ')[0] || pid;

  // Sort balances: winners first. Drop any non-player keys (e.g. stray 'teamA').
  const balanceList = Object.entries(balances)
    .filter(([pid]) => players[pid])
    .sort(([, a], [, b]) => b - a);

  return (
    <div className={styles.section}>
      <div className={styles.sectionLabel}>Bets</div>

      {/* Per-player balance board */}
      {balanceList.length > 0 && (
        <div className={styles.balanceBoard}>
          {balanceList.map(([pid, net]) => (
            <div key={pid} className={styles.balanceRow}>
              <span className={styles.balanceName}>{firstName(pid)}</span>
              <span className={`${styles.balanceAmt}
                ${net > 0 ? styles.balancePos : net < 0 ? styles.balanceNeg : styles.balanceEven}`}>
                {fmt$(net)}
              </span>
            </div>
          ))}
        </div>
      )}

      {/* Nassau bets */}
      {nassauResults.map(({ betId, bet, componentStatuses, pressResults }) => {
        const is2v2 = bet.mode === '2v2';
        const nameA = is2v2 ? (bet.teamAIds || []).map(firstName).join(' & ') : firstName(bet.playerA);
        const nameB = is2v2 ? (bet.teamBIds || []).map(firstName).join(' & ') : firstName(bet.playerB);
        return (
          <div key={betId} className={styles.betCard}>
            <div className={styles.betHeader}>
              <span className={styles.betPlayers}>{nameA} vs {nameB}</span>
              <span className={styles.betMeta}>${bet.amount}/match</span>
            </div>
            {componentStatuses.map(({ label, startHole, endHole, status }) => {
              const decided = status.winner !== 'incomplete';
              const winnerName = status.winner === 'playerA' ? nameA
                : status.winner === 'playerB' ? nameB : null;
              const loserName  = status.winner === 'playerA' ? nameB
                : status.winner === 'playerB' ? nameA : null;
              return (
                <div key={label} className={styles.betSegment}>
                  <span className={styles.betSegLabel}>{label}</span>
                  <span className={`${styles.betSegStatus} ${decided && winnerName ? styles.betSegWon : ''}`}>
                    {decided
                      ? (status.winner === 'half' ? 'Halved'
                        : `${winnerName} wins ${Math.abs(status.diff)}${status.holesPlayed < (endHole - startHole + 1) ? '&' + ((endHole - startHole + 1) - status.holesPlayed) : 'UP'}`)
                      : 'In progress'}
                  </span>
                  {decided && winnerName && (
                    <div className={styles.betSegPayout}>
                      <span className={styles.payoutWin}>{winnerName} +${bet.amount}</span>
                      <span className={styles.payoutLose}>{loserName} -${bet.amount}</span>
                    </div>
                  )}
                </div>
              );
            })}
            {pressResults.map(({ press, status }, pi) => {
              const winnerName = status.winner === 'playerA' ? nameA : status.winner === 'playerB' ? nameB : null;
              const loserName  = status.winner === 'playerA' ? nameB : status.winner === 'playerB' ? nameA : null;
              return (
                <div key={pi} className={styles.pressRow}>
                  <span className={styles.pressLabel}>
                    Press (H{press.startHole}–{press.endHole})
                  </span>
                  <span className={`${styles.pressStatus} ${status.winner !== 'incomplete' ? styles.pressDecided : ''}`}>
                    {status.winner === 'incomplete' ? 'In progress'
                      : status.winner === 'half' ? 'Halved'
                      : `${winnerName} wins`}
                  </span>
                  {status.winner !== 'incomplete' && winnerName && (
                    <div className={styles.betSegPayout}>
                      <span className={styles.payoutWin}>{winnerName} +${bet.amount}</span>
                      <span className={styles.payoutLose}>{loserName} -${bet.amount}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        );
      })}

      {/* Custom bets */}
      {customResults.map(({ betId, bet, winners }) => {
        const players2 = bet.players || (bet.playerA ? [bet.playerA, bet.playerB] : []);
        return (
          <div key={betId} className={styles.betCard}>
            <div className={styles.betHeader}>
              <span className={styles.betPlayers}>{bet.description}</span>
              <span className={styles.betMeta}>${bet.amount}</span>
            </div>
            <div className={styles.customBetFooter}>
              <span className={styles.betPlayers2}>
                {players2.map(firstName).join(', ')}
              </span>
              {bet.status === 'settled' && winners.length > 0 ? (
                <span className={styles.betSegWon}>
                  {winners.map(firstName).join(' & ')} win
                </span>
              ) : (
                <span className={styles.betSegStatus}>Unsettled</span>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Main component ───────────────────────────────────────────────────────────

export default function History() {
  const [archives, setArchives] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [matchesOpen, setMatchesOpen] = useState({});

  useEffect(() => {
    const u = onValue(ref(db, 'tournamentArchives'), (s) => setArchives(s.val() || {}));
    return u;
  }, []);

  if (archives === null) {
    return <div className={styles.page}><div className={styles.empty}>Loading…</div></div>;
  }

  const archiveList = Object.entries(archives).sort(
    ([, a], [, b]) => b.archivedAt - a.archivedAt
  );

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>History</h1>
      </div>

      {archiveList.length === 0 ? (
        <div className={styles.emptyState}>
          <div className={styles.emptyIcon}>📜</div>
          <p className={styles.emptyText}>No past tournaments yet.</p>
          <p className={styles.emptyHint}>
            Use "Archive &amp; Start New" in the Admin panel at the end of a
            tournament to save results here.
          </p>
        </div>
      ) : (
        archiveList.map(([archiveId, archive]) => {
          const isExpanded = !!expanded[archiveId];
          const aWon = archive.teamA.finalPts > archive.teamB.finalPts;
          const bWon = archive.teamB.finalPts > archive.teamA.finalPts;

          const matchesByRound = {};
          (archive.matches || []).forEach((m) => {
            if (!matchesByRound[m.roundId]) matchesByRound[m.roundId] = [];
            matchesByRound[m.roundId].push(m);
          });

          return (
            <div key={archiveId} className={styles.card}>
              {/* ── Card header ─────────────────────────────────────── */}
              <button
                className={styles.cardHeader}
                onClick={() => setExpanded((p) => ({ ...p, [archiveId]: !p[archiveId] }))}
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    <span className={styles.cardName}>{archive.name}</span>
                    <span className={styles.cardDate}>{formatDate(archive.archivedAt)}</span>
                  </div>
                  <span className={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </div>
                <div className={styles.finalScore}>
                  <span className={`${styles.teamScore} ${aWon ? styles.teamScoreWon : ''}`}
                    style={{ color: archive.teamA.color }}>
                    {archive.teamA.name}
                  </span>
                  <span className={styles.scoreDivider}>
                    <span className={`${styles.pts} ${aWon ? styles.ptsWon : ''}`}>
                      {archive.teamA.finalPts}
                    </span>
                    <span className={styles.dash}>–</span>
                    <span className={`${styles.pts} ${bWon ? styles.ptsWon : ''}`}>
                      {archive.teamB.finalPts}
                    </span>
                  </span>
                  <span className={`${styles.teamScore} ${bWon ? styles.teamScoreWon : ''}`}
                    style={{ color: archive.teamB.color }}>
                    {archive.teamB.name}
                  </span>
                </div>
              </button>

              {/* ── Expanded body ────────────────────────────────────── */}
              {isExpanded && (
                <div className={styles.cardBody}>
                  {/* Round results */}
                  {(archive.rounds || []).length > 0 && (
                    <div className={styles.section}>
                      <div className={styles.sectionLabel}>Round Results</div>
                      {archive.rounds.map((r) => {
                        const roundMatches = matchesByRound[r.roundId] || [];
                        const roundKey = `${archiveId}-${r.roundId}`;
                        const roundOpen = matchesOpen[roundKey];
                        return (
                          <div key={r.roundId} className={styles.roundBlock}>
                            <button
                              className={styles.roundRow}
                              onClick={() =>
                                setMatchesOpen((p) => ({ ...p, [roundKey]: !p[roundKey] }))
                              }
                            >
                              <div className={styles.roundInfo}>
                                <span className={styles.roundName}>
                                  Round {r.order} — {FORMAT_LABELS[r.format] || r.format}
                                </span>
                                {r.status === 'complete' && (
                                  <span className={styles.roundComplete}>Complete</span>
                                )}
                              </div>
                              <div className={styles.roundRight}>
                                <div className={styles.roundPts}>
                                  <span style={{ color: archive.teamA.color }}>{r.teamA_pts}</span>
                                  <span className={styles.ptsSep}>/</span>
                                  <span style={{ color: archive.teamB.color }}>{r.teamB_pts}</span>
                                </div>
                                {roundMatches.length > 0 && (
                                  <span className={styles.roundChevron}>{roundOpen ? '▲' : '▼'}</span>
                                )}
                              </div>
                            </button>

                            {roundOpen && roundMatches.length > 0 && (
                              <div className={styles.matchList}>
                                {roundMatches.map((m) => (
                                  <div key={m.matchId} className={styles.matchItem}>
                                    <div className={styles.matchPlayers}>
                                      <span style={{ color: archive.teamA.color }}>
                                        {m.teamAPlayerNames.join(' & ')}
                                      </span>
                                      <span className={styles.matchVs}>vs</span>
                                      <span style={{ color: archive.teamB.color }}>
                                        {m.teamBPlayerNames.join(' & ')}
                                      </span>
                                    </div>
                                    <div className={styles.matchResultRow}>
                                      {m.result ? (
                                        m.result.winner === 'half'
                                          ? <span className={styles.matchStatusHalf}>Halved</span>
                                          : <span className={styles.matchStatusWon}>
                                              {(m.result.winner === 'teamA'
                                                ? m.teamAPlayerNames
                                                : m.teamBPlayerNames).join(' & ')} win
                                            </span>
                                      ) : <span className={styles.matchStatusMuted}>—</span>}
                                      {m.finalStatus && (
                                        <span className={styles.matchFinalStatus}>
                                          {m.finalStatus}
                                        </span>
                                      )}
                                    </div>
                                    {/* Hole strip — only show if data available */}
                                    {m.holeResults && Object.keys(m.holeResults).length > 0 && (
                                      <HoleStrip
                                        holeResults={m.holeResults}
                                        teamAColor={archive.teamA.color}
                                        teamBColor={archive.teamB.color}
                                      />
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* Betting totals */}
                  <BettingSection archive={archive} />
                </div>
              )}
            </div>
          );
        })
      )}

      <div className={styles.bottomPad} />
    </div>
  );
}
