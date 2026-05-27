import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import styles from './Stats.module.css';

function avg(arr) {
  if (!arr.length) return null;
  return (arr.reduce((s, v) => s + v, 0) / arr.length).toFixed(2);
}

function pct(hits, total) {
  if (!total) return '—';
  return `${Math.round((hits / total) * 100)}%`;
}

export default function Stats() {
  const [players, setPlayers] = useState({});
  const [tournament, setTournament] = useState(null);
  const [allHoles, setAllHoles] = useState({});
  const [matches, setMatches] = useState({});

  useEffect(() => {
    const u1 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u2 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    const u3 = onValue(ref(db, 'holes'), (s) => setAllHoles(s.val() || {}));
    const u4 = onValue(ref(db, 'matches'), (s) => setMatches(s.val() || {}));
    return () => { u1(); u2(); u3(); u4(); };
  }, []);

  // Aggregate per-player stats from all hole data
  function getPlayerStats(playerId) {
    const stats = { gross: [], net: [], putts: [], fairways: [], fairwayAttempts: 0, girs: [], total: 0 };
    for (const matchHoles of Object.values(allHoles)) {
      for (const holeScores of Object.values(matchHoles)) {
        const s = holeScores?.[playerId];
        if (!s) continue;
        stats.total++;
        if (s.gross) stats.gross.push(s.gross);
        if (s.net) stats.net.push(s.net);
        if (s.putts != null) stats.putts.push(s.putts);
        if (s.fairwayHit != null) {
          stats.fairwayAttempts++;
          stats.fairways.push(s.fairwayHit ? 1 : 0);
        }
        stats.girs.push(s.gir ? 1 : 0);
      }
    }
    return stats;
  }

  // Team aggregate
  function getTeamStats(teamId) {
    const pids = Object.entries(players).filter(([, p]) => p.teamId === teamId).map(([id]) => id);
    const combined = { gross: [], putts: [], fairways: [], fairwayAttempts: 0, girs: [], total: 0 };
    for (const pid of pids) {
      const s = getPlayerStats(pid);
      combined.gross.push(...s.gross);
      combined.putts.push(...s.putts);
      combined.fairways.push(...s.fairways);
      combined.fairwayAttempts += s.fairwayAttempts;
      combined.girs.push(...s.girs);
      combined.total += s.total;
    }
    return combined;
  }

  const teamAStats = getTeamStats('teamA');
  const teamBStats = getTeamStats('teamB');

  return (
    <div className={styles.page}>
      <h1 className={styles.title}>Stats</h1>

      {/* Team comparison */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Team Stats</div>
        <div className={styles.teamCompare}>
          <div className={styles.teamCol}>
            <div className={`${styles.teamName} ${styles.teamA}`}>{tournament?.teamA?.name || 'Team A'}</div>
            <div className={styles.stat}>{avg(teamAStats.gross) || '—'}</div>
            <div className={styles.stat}>{pct(teamAStats.fairways.reduce((s,v)=>s+v,0), teamAStats.fairwayAttempts)}</div>
            <div className={styles.stat}>{pct(teamAStats.girs.reduce((s,v)=>s+v,0), teamAStats.girs.length)}</div>
            <div className={styles.stat}>{avg(teamAStats.putts) || '—'}</div>
          </div>
          <div className={styles.statLabels}>
            <div />
            <div className={styles.statLabel}>Avg score</div>
            <div className={styles.statLabel}>Fairways</div>
            <div className={styles.statLabel}>GIR</div>
            <div className={styles.statLabel}>Avg putts</div>
          </div>
          <div className={styles.teamCol + ' ' + styles.right}>
            <div className={`${styles.teamName} ${styles.teamB}`}>{tournament?.teamB?.name || 'Team B'}</div>
            <div className={styles.stat}>{avg(teamBStats.gross) || '—'}</div>
            <div className={styles.stat}>{pct(teamBStats.fairways.reduce((s,v)=>s+v,0), teamBStats.fairwayAttempts)}</div>
            <div className={styles.stat}>{pct(teamBStats.girs.reduce((s,v)=>s+v,0), teamBStats.girs.length)}</div>
            <div className={styles.stat}>{avg(teamBStats.putts) || '—'}</div>
          </div>
        </div>
      </div>

      {/* Individual player cards */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Player Stats</div>
        {Object.entries(players).map(([id, player]) => {
          const s = getPlayerStats(id);
          if (!s.total) return null;
          return (
            <div key={id} className={`${styles.playerCard} ${styles[player.teamId]}`}>
              <div className={styles.playerName}>{player.name}</div>
              <div className={styles.playerStatRow}>
                <div className={styles.miniStat}>
                  <span className={styles.miniVal}>{avg(s.gross) || '—'}</span>
                  <span className={styles.miniLabel}>avg score</span>
                </div>
                <div className={styles.miniStat}>
                  <span className={styles.miniVal}>{pct(s.fairways.reduce((a,v)=>a+v,0), s.fairwayAttempts)}</span>
                  <span className={styles.miniLabel}>fairways</span>
                </div>
                <div className={styles.miniStat}>
                  <span className={styles.miniVal}>{pct(s.girs.reduce((a,v)=>a+v,0), s.girs.length)}</span>
                  <span className={styles.miniLabel}>GIR</span>
                </div>
                <div className={styles.miniStat}>
                  <span className={styles.miniVal}>{avg(s.putts) || '—'}</span>
                  <span className={styles.miniLabel}>putts</span>
                </div>
              </div>
            </div>
          );
        })}
        {Object.values(players).every((_, i) => !getPlayerStats(Object.keys(players)[i]).total) && (
          <div className={styles.empty}>No scores yet</div>
        )}
      </div>

      <div className={styles.bottomPad} />
    </div>
  );
}
