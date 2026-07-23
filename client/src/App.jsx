import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { usePlayer } from './usePlayer';
import { useOfflineSync } from './useOfflineSync';
import ConnectivityBanner from './components/ConnectivityBanner';
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

export default function App() {
  const { playerId, isAdmin, selectPlayer, activateAdmin, clearPlayer } = usePlayer();
  const { online, pending, flushing } = useOfflineSync();

  const nav = <Nav />;

  return (
    <BrowserRouter>
      <ConnectivityBanner online={online} pending={pending} flushing={flushing} />
      <Routes>
        <Route path="/select" element={<PlayerSelect onSelect={selectPlayer} />} />

        <Route path="/" element={<><Home playerId={playerId} />{nav}</>} />

        <Route path="/leaderboard" element={<><Leaderboard playerId={playerId} />{nav}</>} />

        {/* Spectators (no player selected) can view matches read-only;
            score entry is gated inside Match by isMyMatch. */}
        <Route
          path="/match/:matchId"
          element={<><Match playerId={playerId} isAdmin={isAdmin} />{nav}</>}
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
