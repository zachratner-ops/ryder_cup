import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import styles from './PlayerSelect.module.css';

export default function PlayerSelect({ onSelect }) {
  const [players, setPlayers] = useState({});
  const [activeSessions, setActiveSessions] = useState({});
  const navigate = useNavigate();

  useEffect(() => {
    const unsub1 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const unsub2 = onValue(ref(db, 'activeSessions'), (s) => setActiveSessions(s.val() || {}));
    return () => { unsub1(); unsub2(); };
  }, []);

  function handleSelect(id) {
    onSelect(id);
    navigate('/');
  }

  const teamA = Object.entries(players).filter(([, p]) => p.teamId === 'teamA');
  const teamB = Object.entries(players).filter(([, p]) => p.teamId === 'teamB');

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1>Who are you?</h1>
        <p className={styles.sub}>Pick your name to enter scores. Just watching? Tap Skip.</p>
      </div>

      <div className={styles.teams}>
        {[['teamA', teamA], ['teamB', teamB]].map(([teamId, list]) => (
          <div key={teamId} className={styles.team}>
            <div className={`${styles.teamLabel} ${styles[teamId]}`}>
              {teamId === 'teamA' ? 'Team A' : 'Team B'}
            </div>
            {list.map(([id, player]) => {
              const active = !!activeSessions[id];
              return (
                <button
                  key={id}
                  className={`${styles.playerBtn} ${active ? styles.claimed : ''}`}
                  onClick={() => handleSelect(id)}
                >
                  <span className={styles.playerName}>{player.name}</span>
                  {active && <span className={styles.activeDot} title="Active on another device" />}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <button className={styles.skip} onClick={() => navigate('/')}>
        Skip — just watching
      </button>
    </div>
  );
}
