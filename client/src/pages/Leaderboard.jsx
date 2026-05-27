import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import TeamLogo from '../components/TeamLogo';
import styles from './Leaderboard.module.css';

export default function Leaderboard({ playerId }) {
  const [leaderboard, setLeaderboard] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [matches, setMatches] = useState({});
  const [rounds, setRounds] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const u1 = onValue(ref(db, 'leaderboard'), (s) => setLeaderboard(s.val()));
    const u2 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    const u3 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    const u4 = onValue(ref(db, 'rounds'), (s) => setRounds(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); };
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
            <div className={styles.teamName}>{tournament.teamA?.name || 'Northwestern'}</div>
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
            <div className={styles.teamName}>{tournament.teamB?.name || 'Nebraska'}</div>
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
                  <span className={styles.roundName}>Round {round.order} — {round.format}</span>
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
          {activeMatches.map(([matchId, match]) => (
            <button
              key={matchId}
              className={styles.matchCard}
              onClick={() => navigate(`/match/${matchId}`)}
            >
              <div className={styles.matchTeams}>
                <span>{match.teamA?.playerIds?.join(' / ') || '—'}</span>
                <span className={styles.matchVs}>vs</span>
                <span>{match.teamB?.playerIds?.join(' / ') || '—'}</span>
              </div>
              {match.currentStatus && (
                <div className={styles.matchStatus}>{match.currentStatus}</div>
              )}
              <div className={styles.matchArrow}>›</div>
            </button>
          ))}
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
