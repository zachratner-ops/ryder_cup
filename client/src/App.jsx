import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';
import { usePlayer } from './usePlayer';
import PlayerSelect from './pages/PlayerSelect';
import Leaderboard from './pages/Leaderboard';
import Match from './pages/Match';
import Stats from './pages/Stats';
import Admin from './pages/Admin';
import Profile from './pages/Profile';
import Nav from './components/Nav';

export default function App() {
  const { playerId, selectPlayer, clearPlayer } = usePlayer();
  const [players, setPlayers] = useState({});

  useEffect(() => {
    const u = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    return u;
  }, []);

  const nav = <Nav playerId={playerId} players={players} />;

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/select" element={<PlayerSelect onSelect={selectPlayer} />} />

        <Route path="/" element={<>{<Leaderboard playerId={playerId} />}{nav}</>} />

        <Route
          path="/match/:matchId"
          element={
            playerId ? (
              <><Match playerId={playerId} />{nav}</>
            ) : (
              <Navigate to="/select" replace />
            )
          }
        />

        <Route path="/stats" element={<><Stats />{nav}</>} />

        <Route
          path="/profile"
          element={
            <><Profile playerId={playerId} onSelect={selectPlayer} onClear={clearPlayer} />{nav}</>
          }
        />

        <Route path="/admin" element={<><Admin />{nav}</>} />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
