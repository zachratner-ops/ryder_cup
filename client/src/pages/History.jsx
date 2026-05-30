import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import styles from './History.module.css';

const FORMAT_LABELS = {
  fourball: 'Four-ball',
  foursomes: 'Foursomes',
  singles: 'Singles',
  yellowball: 'Yellow Ball',
};

function formatDate(ts) {
  return new Date(ts).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

function ResultBadge({ result, teamANames, teamBNames }) {
  if (!result) return <span className={styles.matchStatusMuted}>—</span>;
  if (result.winner === 'half') return <span className={styles.matchStatusHalf}>Halved</span>;
  const winnerNames = result.winner === 'teamA' ? teamANames : teamBNames;
  return <span className={styles.matchStatusWon}>{winnerNames.join(' & ')} win</span>;
}

export default function History() {
  const [archives, setArchives] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [matchesOpen, setMatchesOpen] = useState({});

  useEffect(() => {
    const u = onValue(ref(db, 'tournamentArchives'), (s) => setArchives(s.val() || {}));
    return u;
  }, []);

  if (archives === null) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Loading…</div>
      </div>
    );
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
            Use "Archive & Start New" in the Admin panel at the end of a tournament
            to save results here.
          </p>
        </div>
      ) : (
        archiveList.map(([archiveId, archive]) => {
          const isExpanded = !!expanded[archiveId];
          const aWon = archive.teamA.finalPts > archive.teamB.finalPts;
          const bWon = archive.teamB.finalPts > archive.teamA.finalPts;

          // Group matches by round for display
          const matchesByRound = {};
          (archive.matches || []).forEach((m) => {
            if (!matchesByRound[m.roundId]) matchesByRound[m.roundId] = [];
            matchesByRound[m.roundId].push(m);
          });

          return (
            <div key={archiveId} className={styles.card}>
              {/* ── Card header (always visible) ──────────────────── */}
              <button
                className={styles.cardHeader}
                onClick={() =>
                  setExpanded((prev) => ({ ...prev, [archiveId]: !prev[archiveId] }))
                }
              >
                <div className={styles.cardTop}>
                  <div className={styles.cardMeta}>
                    <span className={styles.cardName}>{archive.name}</span>
                    <span className={styles.cardDate}>{formatDate(archive.archivedAt)}</span>
                  </div>
                  <span className={styles.chevron}>{isExpanded ? '▲' : '▼'}</span>
                </div>

                {/* Final score */}
                <div className={styles.finalScore}>
                  <span
                    className={`${styles.teamScore} ${aWon ? styles.teamScoreWon : ''}`}
                    style={{ color: archive.teamA.color }}
                  >
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
                  <span
                    className={`${styles.teamScore} ${bWon ? styles.teamScoreWon : ''}`}
                    style={{ color: archive.teamB.color }}
                  >
                    {archive.teamB.name}
                  </span>
                </div>
              </button>

              {/* ── Expanded body ──────────────────────────────────── */}
              {isExpanded && (
                <div className={styles.cardBody}>
                  {/* Round-by-round breakdown */}
                  {(archive.rounds || []).length > 0 && (
                    <div className={styles.section}>
                      <div className={styles.sectionLabel}>Round Results</div>
                      {archive.rounds.map((r) => {
                        const rMatchesForRound = matchesByRound[r.roundId] || [];
                        const roundOpen = matchesOpen[`${archiveId}-${r.roundId}`];
                        return (
                          <div key={r.roundId} className={styles.roundBlock}>
                            <button
                              className={styles.roundRow}
                              onClick={() =>
                                setMatchesOpen((prev) => ({
                                  ...prev,
                                  [`${archiveId}-${r.roundId}`]: !prev[`${archiveId}-${r.roundId}`],
                                }))
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
                                  <span style={{ color: archive.teamA.color }}>
                                    {r.teamA_pts}
                                  </span>
                                  <span className={styles.ptsSep}>/</span>
                                  <span style={{ color: archive.teamB.color }}>
                                    {r.teamB_pts}
                                  </span>
                                </div>
                                {rMatchesForRound.length > 0 && (
                                  <span className={styles.roundChevron}>
                                    {roundOpen ? '▲' : '▼'}
                                  </span>
                                )}
                              </div>
                            </button>

                            {/* Individual match results */}
                            {roundOpen && rMatchesForRound.length > 0 && (
                              <div className={styles.matchList}>
                                {rMatchesForRound.map((m) => (
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
                                      <ResultBadge
                                        result={m.result}
                                        teamANames={m.teamAPlayerNames}
                                        teamBNames={m.teamBPlayerNames}
                                      />
                                      {m.finalStatus && (
                                        <span className={styles.matchFinalStatus}>
                                          {m.finalStatus}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
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
