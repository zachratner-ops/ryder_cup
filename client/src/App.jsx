import { BrowserRouter, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import { usePlayer } from './usePlayer';
import PlayerSelect from './pages/PlayerSelect';
import Home from './pages/Home';
import Leaderboard from './pages/Leaderboard';
import Match from './pages/Match';
import Stats from './pages/Stats';
import Bets from './pages/Bets';
import History from './pages/History';
import Admin from './pages/Admin';
import Profile from './pages/Profile';
import Nav from './components/Nav';
import styles from './App.module.css';

function ProfileAvatar({ playerId, players }) {
  const location = useLocation();
  // Hide on profile and select pages
  if (location.pathname === '/profile' || location.pathname === '/select') return null;
  const initial = playerId && players?.[playerId]?.name?.[0]?.toUpperCase();
  return (
    <Link to="/profile" className={styles.profileAvatar} aria-label="Profile">
      {initial || '👤'}
    </Link>
  );
}

export default function App() {
  const { playerId, isAdmin, selectPlayer, activateAdmin, clearPlayer } = usePlayer();
  const [players, setPlayers] = useState({});

  useEffect(() => {
    const u = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    return u;
  }, []);

  const nav = <Nav />;

  return (
    <BrowserRouter>
      <ProfileAvatar playerId={playerId} players={players} />
      <Routes>
        <Route path="/select" element={<PlayerSelect onSelect={selectPlayer} />} />

        <Route path="/" element={<><Home playerId={playerId} />{nav}</>} />

        <Route path="/leaderboard" element={<><Leaderboard playerId={playerId} />{nav}</>} />

        <Route
          path="/match/:matchId"
          element={
            (playerId || isAdmin) ? (
              <><Match playerId={playerId} isAdmin={isAdmin} />{nav}</>
            ) : (
              <Navigate to="/select" replace />
            )
          }
        />

        <Route path="/stats" element={<><Stats />{nav}</>} />

        <Route path="/bets" element={<><Bets playerId={playerId} />{nav}</>} />

        <Route path="/history" element={<><History />{nav}</>} />

        <Route
          path="/profile"
          element={
            <><Profile
              playerId={playerId}
              isAdmin={isAdmin}
              onSelect={selectPlayer}
              onClear={clearPlayer}
              onActivateAdmin={activateAdmin}
            />{nav}</>
          }
        />

        <Route path="/admin" element={<><Admin />{nav}</>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
