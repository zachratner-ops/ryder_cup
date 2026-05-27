import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue, set } from 'firebase/database';
import { db } from '../firebase';
import styles from './Profile.module.css';

export default function Profile({ playerId, onSelect, onClear }) {
  const [players, setPlayers] = useState({});
  const [activeSessions, setActiveSessions] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const u1 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u2 = onValue(ref(db, 'activeSessions'), (s) => setActiveSessions(s.val() || {}));
    return () => { u1(); u2(); };
  }, []);

  function handleSelect(id) {
    onSelect(id);
    navigate(-1);
  }

  function handleSpectate() {
    onClear();
    navigate('/');
  }

  const current = playerId ? players[playerId] : null;
  const teamA = Object.entries(players).filter(([, p]) => p.teamId === 'teamA');
  const teamB = Object.entries(players).filter(([, p]) => p.teamId === 'teamB');

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Profile</h1>
        {current && (
          <div className={styles.currentBadge}>
            Playing as <strong>{current.name}</strong>
          </div>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>Switch player</div>

        {[['teamA', teamA], ['teamB', teamB]].map(([teamId, list]) => (
          <div key={teamId} className={styles.team}>
            <div className={`${styles.teamLabel} ${styles[teamId]}`}>
              {teamId === 'teamA' ? (players[list[0]?.[0]]?.teamId === 'teamA' ? 'Northwestern' : 'Team A') : 'Nebraska'}
            </div>
            {list.map(([id, player]) => {
              const isMe = id === playerId;
              const activeElsewhere = activeSessions[id] && !isMe;
              return (
                <button
                  key={id}
                  className={`${styles.playerBtn} ${isMe ? styles.selected : ''}`}
                  onClick={() => handleSelect(id)}
                >
                  <span className={styles.playerName}>{player.name}</span>
                  <div className={styles.playerMeta}>
                    {isMe && <span className={styles.youBadge}>You</span>}
                    {activeElsewhere && <span className={styles.activeDot} title="Active on another device" />}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <button className={styles.spectateBtn} onClick={handleSpectate}>
        Switch to spectator mode
      </button>
    </div>
  );
}
