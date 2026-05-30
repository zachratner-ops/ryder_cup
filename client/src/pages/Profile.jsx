import { useEffect, useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import styles from './Profile.module.css';

export default function Profile({ playerId, isAdmin, onSelect, onClear, onActivateAdmin }) {
  const [players, setPlayers] = useState({});
  const [activeSessions, setActiveSessions] = useState({});
  const [skPin, setSkPin] = useState('');
  const [skError, setSkError] = useState('');
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

  async function handleActivateAdmin(e) {
    e.preventDefault();
    setSkError('');
    const snap = await new Promise(resolve =>
      onValue(ref(db, 'tournament/adminPin'), resolve, { onlyOnce: true })
    );
    const storedPin = snap.val();
    if (!storedPin || skPin !== storedPin) {
      setSkError('Wrong PIN');
      return;
    }
    onActivateAdmin();
    setSkPin('');
    navigate('/');
  }

  const current = playerId ? players[playerId] : null;
  const teamA = Object.entries(players).filter(([, p]) => p.teamId === 'teamA');
  const teamB = Object.entries(players).filter(([, p]) => p.teamId === 'teamB');

  return (
    <div className={styles.page}>
      <div className={styles.header}>
        <h1 className={styles.title}>Profile</h1>
        {isAdmin && (
          <div className={styles.currentBadge}>
            Score Keeper mode active
          </div>
        )}
        {current && !isAdmin && (
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
              {teamId === 'teamA' ? 'Northwestern' : 'Nebraska'}
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

      {/* Score Keeper section */}
      <div className={styles.section}>
        <div className={styles.sectionLabel}>Score Keeper</div>
        {isAdmin ? (
          <div className={styles.skActiveCard}>
            <span className={styles.skActiveBadge}>✓ Active</span>
            <p className={styles.skHint}>You can enter scores for any player in any match.</p>
            <button className={styles.skDeactivateBtn} onClick={() => { onClear(); navigate('/'); }}>
              Deactivate Score Keeper
            </button>
          </div>
        ) : (
          <form onSubmit={handleActivateAdmin} className={styles.skForm}>
            <p className={styles.skHint}>Enter the admin PIN to score for any player.</p>
            <div className={styles.skRow}>
              <input
                type="password"
                inputMode="numeric"
                placeholder="Admin PIN"
                value={skPin}
                onChange={e => { setSkPin(e.target.value); setSkError(''); }}
                className={styles.skPinInput}
              />
              <button type="submit" className={styles.skActivateBtn}>
                Activate
              </button>
            </div>
            {skError && <div className={styles.skError}>{skError}</div>}
          </form>
        )}
      </div>

      <div className={styles.section}>
        <div className={styles.sectionLabel}>More</div>
        <Link to="/history" className={styles.menuLink}>
          <span className={styles.menuIcon}>📜</span>
          <span>Tournament History</span>
          <span className={styles.menuChevron}>›</span>
        </Link>
        <Link to="/admin" className={styles.menuLink}>
          <span className={styles.menuIcon}>⚙️</span>
          <span>Admin Panel</span>
          <span className={styles.menuChevron}>›</span>
        </Link>
      </div>

      <button className={styles.spectateBtn} onClick={handleSpectate}>
        Switch to spectator mode
      </button>
    </div>
  );
}
