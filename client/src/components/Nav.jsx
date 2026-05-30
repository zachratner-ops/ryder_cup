import { NavLink } from 'react-router-dom';
import styles from './Nav.module.css';

export default function Nav() {
  return (
    <nav className={styles.nav}>
      <NavLink to="/" end className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>🏌️</span>
        <span>My Match</span>
      </NavLink>
      <NavLink to="/leaderboard" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>🏆</span>
        <span>Standings</span>
      </NavLink>
      <NavLink to="/bets" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>💰</span>
        <span>Bets</span>
      </NavLink>
      <NavLink to="/stats" className={({ isActive }) => isActive ? styles.active : ''}>
        <span className={styles.icon}>📊</span>
        <span>Stats</span>
      </NavLink>
    </nav>
  );
}
