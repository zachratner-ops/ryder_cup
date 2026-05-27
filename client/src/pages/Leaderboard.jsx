import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import TeamLogo from '../components/TeamLogo';
import styles from './Leaderboard.module.css';

function computeMatchInfo(matchHoles) {
  let diff = 0;
  let holesPlayed = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = matchHoles?.[h];
    if (!hole?.holeWinner) continue;
    holesPlayed++;
    if (hole.holeWinner === 'teamA') diff++;
    else if (hole.holeWinner === 'teamB') diff--;
  }
  return { diff, holesPlayed };
}

export default function Leaderboard({ playerId }) {
  const [leaderboard, setLeaderboard] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState({});
  const [rounds, setRounds] = useState({});
  const [players, setPlayers] = useState({});
  const [allHoles, setAllHoles] = useState({});
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

  const activeMatches = Object.entries(matches).filter(([, m]) => m.status === 'active');
  const roundList = Object.entries(rounds).sort(([, a], [, b]) => a.order - b.order);

    const teamAName = tournament.teamA?.name || 'Northwestern';
  const teamBName = tournament.teamB?.name || 'Nebraska';

  const formatLabel = (f) => {
    const labels = { fourball: 'Four-ball', foursomes: 'Foursomes', singles: 'Singles', yellowball: 'Yellow Ball' };
    return labels[f] || f;
  };

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <img src="/gb-logo.webp" alt="GrayBull" className={styles.eventLogo} />
      </div>

      {/* Team score banner */}
      <div className={styles.scoreBanner}>
        <div className={`${styles.teamScore} ${styles.teamA}`}>
          <div className={styles.teamLogoRow}>
            <TeamLogo teamId="teamA" size={40} />
            <div className={styles.teamName}>{teamAName}</div>
          </div>
          <div className={styles.pts}>{leaderboard?.teamA_pts ?? 0}</div>
        </div>
        <div className={styles.vs}>
          <div className={styles.vsLabel}>vs</div>
          <div className={styles.ptsAvail}>{leaderboard?.ptsAvailable ?? 0} pts left</div>
        </div>
        <div className={`${styles.teamScore} ${styles.teamB}`}>
          <div className={styles.teamLogoRow}>
            <TeamLogo teamId="teamB" size={40} />
            <div className={styles.teamName}>{teamBName}</div>
          </div>
          <div className={styles.pts}>{leaderboard?.teamB_pts ?? 0}</div>
        </div>
      </div>

      {/* Round breakdown */}
      {roundList.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Rounds</div>
          {roundList.map(([roundId, round]) => {
            const lb = leaderboard?.rounds?.[roundId];
            return (
              <div key={roundId} className={styles.roundRow}>
                <div className={styles.roundInfo}>
                  <span className={styles.roundName}>Round {round.order} — {formatLabel(round.format)}</span>
                  <span className={`${styles.roundStatus} ${round.status === 'active' ? styles.live : ''}`}>
                    {round.status === 'active' ? 'LIVE' : round.status}
                  </span>
                </div>
                <div className={styles.roundPts}>
                  <span className={styles.ptA}>{lb?.teamA_pts ?? '—'}</span>
                  <span className={styles.ptSep}>/</span>
                  <span className={styles.ptB}>{lb?.teamB_pts ?? '—'}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Active matches */}
      {activeMatches.length > 0 && (
        <div className={styles.section}>
          <div className={styles.sectionLabel}>Live Matches</div>
          {activeMatches.map(([matchId, match]) => {
            const matchHoles = allHoles[matchId] || {};
            const { diff, holesPlayed } = computeMatchInfo(matchHoles);
            const remaining = 18 - holesPlayed;
            const margin = Math.abs(diff);

            let statusText, leader;
            if (holesPlayed === 0 || diff === 0) {
              statusText = 'All Square';
              leader = null;
            } else {
              leader = diff > 0 ? 'teamA' : 'teamB';
              const leadName = diff > 0 ? teamAName : teamBName;
              statusText = margin > remaining
                ? `${leadName} wins ${margin}&${remaining}`
                : `${leadName} ${margin}UP`;
            }
            const thruText = holesPlayed === 0 ? 'Not started' : `Thru ${holesPlayed}`;

            const teamANames = match.teamA?.playerIds?.map(id => players[id]?.name?.split(' ')[0] || id).join(' & ') || '—';
            const teamBNames = match.teamB?.playerIds?.map(id => players[id]?.name?.split(' ')[0] || id).join(' & ') || '—';

            return (
              <button
                key={matchId}
                className={styles.matchCard}
                onClick={() => navigate(`/match/${matchId}`)}
              >
                {/* 3-column info row */}
                <div className={styles.mcInfoRow}>
                  {/* Left: Team A */}
                  <div className={styles.mcSide}>
                    <div className={styles.mcTeamRow}>
                      <TeamLogo teamId="teamA" size={20} />
                      <span className={styles.mcNameA}>{teamANames}</span>
                    </div>
                    {leader === 'teamA' && (
                      <span className={styles.mcUp} style={{ color: 'var(--teamA)', paddingLeft: 26 }}>{margin}UP</span>
                    )}
                  </div>

                  {/* Center: thru / all square */}
                  <div className={styles.mcCenter}>
                    {leader === null && holesPlayed > 0 && (
                      <span className={styles.mcAllSquare}>All Square</span>
                    )}
                    <span className={styles.mcThruText}>
                      {holesPlayed > 0 ? `Thru ${holesPlayed}` : '—'}
                    </span>
                  </div>

                  {/* Right: Team B */}
                  <div className={`${styles.mcSide} ${styles.mcSideRight}`}>
                    <div className={`${styles.mcTeamRow} ${styles.mcTeamRowRight}`}>
                      <span className={styles.mcNameB}>{teamBNames}</span>
                      <TeamLogo teamId="teamB" size={20} />
                    </div>
                    {leader === 'teamB' && (
                      <span className={styles.mcUp} style={{ color: 'var(--teamB)', paddingRight: 26 }}>{margin}UP</span>
                    )}
                  </div>
                </div>

                {/* Full-width hole strip */}
                <div className={styles.mcHoleStrip}>
                  {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
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
      )}

      {/* Spectator / no player banner */}
      {!playerId && (
        <button className={styles.joinBtn} onClick={() => navigate('/select')}>
          Select your name to enter scores
        </button>
      )}

      <div className={styles.bottomPad} />
    </div>
  );
}
