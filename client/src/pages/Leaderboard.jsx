import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import TeamLogo from '../components/TeamLogo';
import styles from './Leaderboard.module.css';

function computeMatchInfo(matchHoles) {
  let diff = 0;
  let holesPlayed = 0;
  let decidedMargin = null, decidedRemaining = null;
  for (let h = 1; h <= 18; h++) {
    const hole = matchHoles?.[h];
    if (!hole?.holeWinner) continue;
    holesPlayed++;
    if (hole.holeWinner === 'teamA') diff++;
    else if (hole.holeWinner === 'teamB') diff--;
    // Detect match decided: capture margin & remaining at the closing hole
    if (decidedMargin === null) {
      const margin = Math.abs(diff);
      const remaining = 18 - holesPlayed;
      if (margin > remaining) { decidedMargin = margin; decidedRemaining = remaining; }
    }
  }
  return { diff, holesPlayed, decidedMargin, decidedRemaining };
}

// Yellow ball: cumulative stroke differential (lower = better)
function computeYBInfo(matchHoles) {
  let cumA = 0, cumB = 0, holesPlayed = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = matchHoles?.[h];
    if (hole?.ybNetA == null || hole?.ybNetB == null) break;
    cumA += hole.ybNetA;
    cumB += hole.ybNetB;
    holesPlayed++;
  }
  // diff < 0 → teamA leads; diff > 0 → teamB leads
  return { diff: cumA - cumB, holesPlayed };
}

// Scramble: cumulative team gross differential (lower = better)
function computeScrambleInfo(matchHoles, holeCount) {
  let cumA = 0, cumB = 0, holesPlayed = 0;
  for (let h = 1; h <= holeCount; h++) {
    const hole = matchHoles?.[h];
    if (hole?.teamA?.gross == null || hole?.teamB?.gross == null) break;
    cumA += hole.teamA.gross;
    cumB += hole.teamB.gross;
    holesPlayed++;
  }
  return { diff: cumA - cumB, holesPlayed };
}

// Match-play hole diff within a range (for segment-scored fourball)
function computeSegDiff(matchHoles, startH, endH) {
  let diff = 0, played = 0;
  for (let h = startH; h <= endH; h++) {
    const hw = matchHoles?.[h]?.holeWinner;
    if (!hw) continue;
    played++;
    if (hw === 'teamA') diff++;
    else if (hw === 'teamB') diff--;
  }
  return { diff, played };
}

const scrambleHoleCount = (match) => (match.holeCount === 9 ? 9 : 18);

const formatLabel = (f) => {
  const labels = { fourball: 'Four-ball', foursomes: 'Foursomes', singles: 'Singles', yellowball: 'Yellow Ball', scramble: 'Scramble' };
  return labels[f] || f;
};

export default function Leaderboard({ playerId }) {
  const [leaderboard, setLeaderboard] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState({});
  const [rounds, setRounds] = useState({});
  const [players, setPlayers] = useState({});
  const [allHoles, setAllHoles] = useState({});
  const [expandedRounds, setExpandedRounds] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const u1 = onValue(ref(db, 'leaderboard'), (s) => setLeaderboard(s.val()));
    const u2 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    const u3 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    const u4 = onValue(ref(db, 'rounds'), (s) => setRounds(s.val() || {}));
    const u5 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u6 = onValue(ref(db, 'holes'), (s) => setAllHoles(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); u5(); u6(); };
  }, []);

  if (!tournament) {
    return (
      <div className={styles.page}>
        <div className={styles.empty}>Setting up tournament…</div>
      </div>
    );
  }

  const ptsA = leaderboard?.teamA_pts ?? 0;
  const ptsB = leaderboard?.teamB_pts ?? 0;
  const ptsAvail = leaderboard?.ptsAvailable ?? 0;
  const totalPts = ptsA + ptsB + ptsAvail;
  // Each slot = 1 point, split into 2 half-sub-segments for half-point resolution
  const numSlots = Math.max(Math.ceil(totalPts), 4);

  // Live projected points from active matches
  let liveAPoints = 0;
  let liveBPoints = 0;
  Object.entries(matches).forEach(([matchId, match]) => {
    if (match.status !== 'active') return;
    const round = rounds[match.roundId];
    const matchHoles = allHoles[matchId] || {};

    // Segment-scored fourball: project Front 9 / Back 9 / Overall separately
    if (match.format === 'fourball' && round?.segmentPoints) {
      const segDefs = [['front', 1, 9], ['back', 10, 18], ['overall', 1, 18]];
      for (const [key, startH, endH] of segDefs) {
        const segPts = parseFloat(round.segmentPoints[key]) || 0;
        const { diff, played } = computeSegDiff(matchHoles, startH, endH);
        if (played === 0) continue;
        if (diff > 0) liveAPoints += segPts;
        else if (diff < 0) liveBPoints += segPts;
        else { liveAPoints += segPts / 2; liveBPoints += segPts / 2; }
      }
      return;
    }

    const pts = round?.pointsValue || 1;
    const isYB = match.format === 'yellowball';
    const isScr = match.format === 'scramble';
    // YB/scramble: negative diff = teamA leads (fewer strokes); match play: positive diff = teamA leads
    const { diff, holesPlayed } = isYB
      ? computeYBInfo(matchHoles)
      : isScr
      ? computeScrambleInfo(matchHoles, scrambleHoleCount(match))
      : computeMatchInfo(matchHoles);
    const lowerWins = isYB || isScr;
    const aLeads = lowerWins ? diff < 0 : diff > 0;
    const bLeads = lowerWins ? diff > 0 : diff < 0;
    if (aLeads) liveAPoints += pts;
    else if (bLeads) liveBPoints += pts;
    else if (holesPlayed > 0) { liveAPoints += pts / 2; liveBPoints += pts / 2; }
  });

  // Boundaries: A fills from left, B fills from right, live fills adjacent gaps
  const aTerrEnd = Math.ceil(ptsA);
  const bTerrStart = numSlots - Math.ceil(ptsB);
  const liveAEnd = aTerrEnd + Math.ceil(liveAPoints);
  const liveBStart = bTerrStart - Math.ceil(liveBPoints);

  function getSlotState(i) {
    // A finalized (whole points)
    if (i < Math.floor(ptsA)) return 'A';
    // A half-point
    if (i === Math.floor(ptsA) && (ptsA % 1) >= 0.5) return 'A-half';
    // B finalized (whole points, from right)
    const fromRight = numSlots - 1 - i;
    if (fromRight < Math.floor(ptsB)) return 'B';
    // B half-point
    if (fromRight === Math.floor(ptsB) && (ptsB % 1) >= 0.5) return 'B-half';
    // Live A projection (fills after A's territory)
    if (i >= aTerrEnd && i < liveAEnd) return 'liveA';
    // Live B projection (fills before B's territory)
    if (i >= liveBStart && i < bTerrStart) return 'liveB';
    return 'empty';
  }

  function getSubSegs(state, i) {
    // For half-point slots the "open" sub-segment should match whatever
    // colour would immediately follow — live projection or empty — so
    // there is no white gap between the half-point bar and its neighbour.
    const rightOfAHalf = i < liveAEnd ? styles.segLiveA : styles.segEmpty;
    const leftOfBHalf  = i >= liveBStart ? styles.segLiveB : styles.segEmpty;
    switch (state) {
      case 'A':      return [styles.segA, styles.segA];
      case 'A-half': return [styles.segA, rightOfAHalf];
      case 'B':      return [styles.segB, styles.segB];
      case 'B-half': return [leftOfBHalf, styles.segB];
      case 'liveA':  return [styles.segLiveA, styles.segLiveA];
      case 'liveB':  return [styles.segLiveB, styles.segLiveB];
      default:       return [styles.segEmpty, styles.segEmpty];
    }
  }

  const roundList = Object.entries(rounds).sort(([, a], [, b]) => a.order - b.order);

  // Group matches by roundId
  const matchesByRound = {};
  Object.entries(matches).forEach(([matchId, match]) => {
    const rid = match.roundId;
    if (!matchesByRound[rid]) matchesByRound[rid] = [];
    matchesByRound[rid].push([matchId, match]);
  });

  function toggleRound(roundId) {
    setExpandedRounds(prev => ({ ...prev, [roundId]: !isRoundExpanded(roundId) }));
  }

  function isRoundExpanded(roundId) {
    if (expandedRounds[roundId] !== undefined) return expandedRounds[roundId];
    return rounds[roundId]?.status === 'active' || rounds[roundId]?.status === 'staged';
  }

  const teamAName = tournament.teamA?.name || 'Northwestern';
  const teamBName = tournament.teamB?.name || 'Nebraska';

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <img src="/gb-logo.webp" alt="GrayBull" className={styles.eventLogo} />
      </div>

      {/* Score bar banner */}
      <div className={styles.scoreBanner}>
        <div className={styles.bannerRow}>
          <TeamLogo teamId="teamA" size={44} />
          <div className={styles.barTrack}>
            {Array.from({ length: numSlots }, (_, i) => {
              const [leftCls, rightCls] = getSubSegs(getSlotState(i), i);
              return (
                <div key={i} className={styles.pointGroup}>
                  <div className={`${styles.seg} ${leftCls}`} />
                  <div className={`${styles.seg} ${rightCls}`} />
                </div>
              );
            })}
          </div>
          <TeamLogo teamId="teamB" size={44} />
        </div>
        <div className={styles.bannerScores}>
          <span className={styles.scoreA}>{ptsA}</span>
          <span className={styles.ptsAvailLabel}>{ptsAvail} pts left</span>
          <span className={styles.scoreB}>{ptsB}</span>
        </div>
      </div>

      {/* Rounds with nested matches */}
      {roundList.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Rounds</div>
          {roundList.map(([roundId, round]) => {
            const lb = leaderboard?.rounds?.[roundId];
            const roundMatches = matchesByRound[roundId] || [];
            const expanded = isRoundExpanded(roundId);

            return (
              <div key={roundId} className={`${styles.roundBlock} ${round.status === 'active' ? styles.roundBlockActive : ''}`}>
                {/* Round header row */}
                <button
                  className={`${styles.roundRow} ${round.status === 'active' ? styles.roundRowActive : round.status === 'complete' ? styles.roundRowComplete : ''}`}
                  onClick={() => toggleRound(roundId)}
                >
                  <div className={styles.roundInfo}>
                    <span className={styles.roundName}>Round {round.order} — {formatLabel(round.format)}</span>
                    <span className={`${styles.roundStatus} ${round.status === 'active' ? styles.live : ''}`}>
                      {round.status === 'active' ? 'LIVE' : round.status}
                    </span>
                  </div>
                  <div className={styles.roundRight}>
                    <div className={styles.roundPts}>
                      <span className={styles.ptA}>{lb?.teamA_pts ?? '—'}</span>
                      <span className={styles.ptSep}>/</span>
                      <span className={styles.ptB}>{lb?.teamB_pts ?? '—'}</span>
                    </div>
                    <span className={styles.chevron}>{expanded ? '▲' : '▼'}</span>
                  </div>
                </button>

                {/* Nested match cards */}
                {expanded && roundMatches.map(([matchId, match]) => {
                  const matchHoles = allHoles[matchId] || {};
                  const isYB = match.format === 'yellowball';
                  const isScr = match.format === 'scramble';
                  const stripHoles = isScr ? scrambleHoleCount(match) : 18;

                  // Compute who's leading and by how much
                  let holesPlayed, leader, margin, decidedMargin = null, decidedRemaining = null;
                  if (isYB || isScr) {
                    const info = isYB
                      ? computeYBInfo(matchHoles)
                      : computeScrambleInfo(matchHoles, stripHoles);
                    holesPlayed = info.holesPlayed;
                    leader = info.holesPlayed > 0 && info.diff !== 0
                      ? (info.diff < 0 ? 'teamA' : 'teamB') : null;
                    margin = Math.abs(info.diff);
                  } else {
                    const info = computeMatchInfo(matchHoles);
                    holesPlayed = info.holesPlayed;
                    leader = info.holesPlayed > 0 && info.diff !== 0
                      ? (info.diff > 0 ? 'teamA' : 'teamB') : null;
                    margin = Math.abs(info.diff);
                    decidedMargin = info.decidedMargin;
                    decidedRemaining = info.decidedRemaining;
                  }

                  // Team formats show team names; match play shows player first names
                  const displayA = (isYB || isScr)
                    ? teamAName
                    : match.teamA?.playerIds?.map(id => players[id]?.name?.split(' ')[0] || id).join(' & ') || '—';
                  const displayB = (isYB || isScr)
                    ? teamBName
                    : match.teamB?.playerIds?.map(id => players[id]?.name?.split(' ')[0] || id).join(' & ') || '—';

                  // Lead text: "Up by N stroke(s)" for stroke-play formats; "N&R" (decided) or "NUP" for match play
                  const leadText = (isYB || isScr)
                    ? `Up by ${margin} stroke${margin !== 1 ? 's' : ''}`
                    : decidedMargin != null ? `${decidedMargin}&${decidedRemaining}` : `${margin}UP`;

                  return (
                    <button
                      key={matchId}
                      className={styles.matchCard}
                      onClick={() => navigate(`/match/${matchId}`)}
                    >
                      <div className={styles.mcInfoRow}>
                        <div className={styles.mcSide}>
                          <div className={styles.mcTeamRow}>
                            <TeamLogo teamId="teamA" size={18} />
                            <span className={styles.mcNameA}>{displayA}</span>
                          </div>
                          {leader === 'teamA' && (
                            <span className={(isYB || isScr) ? styles.mcUpSm : styles.mcUp} style={{ color: 'var(--teamA)', paddingLeft: 24 }}>
                              {leadText}
                            </span>
                          )}
                        </div>

                        <div className={styles.mcCenter}>
                          {leader === null && holesPlayed > 0 && (
                            <span className={styles.mcAllSquare}>{(isYB || isScr) ? 'Tied' : 'All Square'}</span>
                          )}
                          <span className={styles.mcThruText}>
                            {holesPlayed > 0 ? `Thru ${holesPlayed}`
                              : match.status === 'active' ? 'Starting'
                              : match.status === 'staged' ? 'Staged'
                              : '—'}
                          </span>
                        </div>

                        <div className={`${styles.mcSide} ${styles.mcSideRight}`}>
                          <div className={`${styles.mcTeamRow} ${styles.mcTeamRowRight}`}>
                            <span className={styles.mcNameB}>{displayB}</span>
                            <TeamLogo teamId="teamB" size={18} />
                          </div>
                          {leader === 'teamB' && (
                            <span className={(isYB || isScr) ? styles.mcUpSm : styles.mcUp} style={{ color: 'var(--teamB)', paddingRight: 24 }}>
                              {leadText}
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Front 9 / Back 9 / Overall status for segment-scored fourball */}
                      {match.format === 'fourball' && round.segmentPoints && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          {[['front', 'F9', 1, 9], ['back', 'B9', 10, 18], ['overall', '18', 1, 18]].map(([key, label, startH, endH]) => {
                            const segPts = round.segmentPoints[key] ?? 0;
                            const seg = computeSegDiff(matchHoles, startH, endH);
                            const segTeam = seg.diff > 0 ? 'teamA' : seg.diff < 0 ? 'teamB' : null;
                            const segTxt = seg.played === 0 ? '—' : seg.diff === 0 ? 'AS' : `${Math.abs(seg.diff)}UP`;
                            return (
                              <div
                                key={key}
                                style={{
                                  flex: 1, textAlign: 'center', padding: '4px 2px',
                                  background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8,
                                }}
                              >
                                <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'var(--text-muted)' }}>
                                  {label} · {segPts}pt{segPts !== 1 ? 's' : ''}
                                </div>
                                <div style={{ fontSize: 12, fontWeight: 700, marginTop: 1, color: segTeam ? `var(--${segTeam})` : 'var(--text-muted)' }}>
                                  {segTxt}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      )}

                      <div className={styles.mcHoleStrip}>
                        {Array.from({ length: stripHoles }, (_, i) => i + 1).map((h) => {
                          const winner = matchHoles[h]?.holeWinner;
                          const dotClass = winner === 'teamA' ? styles.mcDotA
                            : winner === 'teamB' ? styles.mcDotB
                            : winner === 'half' ? styles.mcDotHalf
                            : styles.mcDotEmpty;
                          return (
                            <div key={h} className={`${styles.mcHoleDot} ${dotClass}`}>
                              <span className={styles.mcDotNum}>{h}</span>
                            </div>
                          );
                        })}
                      </div>
                    </button>
                  );
                })}
              </div>
            );
          })}
        </div>
      )}

      {!playerId && (
        <button className={styles.joinBtn} onClick={() => navigate('/select')}>
          Select your name to enter scores
        </button>
      )}

      <div className={styles.bottomPad} />
    </div>
  );
}
