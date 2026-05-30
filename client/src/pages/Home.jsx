import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ref, onValue } from 'firebase/database';
import { db } from '../firebase';
import Leaderboard from './Leaderboard';

// Checks if the player has an active match and redirects there.
// Falls back to rendering the Leaderboard if no active match found.
export default function Home({ playerId }) {
  const navigate = useNavigate();
  const [checked, setChecked] = useState(false);
  const cancelled = useRef(false);

  useEffect(() => {
    if (!playerId) { setChecked(true); return; }
    cancelled.current = false;

    Promise.all([
      new Promise(resolve => onValue(ref(db, 'matches'), s => resolve(s.val() || {}), { onlyOnce: true })),
      new Promise(resolve => onValue(ref(db, 'rounds'),  s => resolve(s.val() || {}), { onlyOnce: true })),
    ]).then(([matches, rounds]) => {
      if (cancelled.current) return;
      const entry = Object.entries(matches).find(([, match]) => {
        const round = rounds[match.roundId];
        if (round?.status !== 'active') return false;
        if (match.status === 'complete') return false;
        return [...(match.teamA?.playerIds || []), ...(match.teamB?.playerIds || [])].includes(playerId);
      });
      if (entry) {
        navigate(`/match/${entry[0]}`, { replace: true });
      } else {
        setChecked(true);
      }
    });

    return () => { cancelled.current = true; };
  }, [playerId, navigate]);

  if (!checked && playerId) return null; // brief while checking

  return <Leaderboard playerId={playerId} />;
}
