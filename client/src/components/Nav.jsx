import { NavLink } from 'react-router-dom';
import styles from './Nav.module.css';

export default function Nav({ playerId, players }) {
  const playerName = playerId && players?.[playerId]?.name;

  return (
    <nav className={styles.nav}>
      <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>🏆</span>
        <span>Leaderboard</span>
      </NavLink>
      <NavLink to="/stats" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>📊</span>
        <span>Stats</span>
      </NavLink>
      <NavLink to="/bets" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>💰</span>
        <span>Bets</span>
      </NavLink>
      <NavLink to="/profile" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>👤</span>
        <span>{playerName || 'Profile'}</span>
      </NavLink>
      <NavLink to="/admin" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>⚙️</span>
        <span>Admin</span>
      </NavLink>
    </nav>
  );
}
