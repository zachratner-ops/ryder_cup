import { useState, useEffect } from 'react';
import { db } from './firebase';
import { ref, set, serverTimestamp } from 'firebase/database';

const STORAGE_KEY = 'ryder_playerId';

export function usePlayer() {
  const [playerId, setPlayerIdState] = useState(() => localStorage.getItem(STORAGE_KEY));

  function selectPlayer(id) {
    localStorage.setItem(STORAGE_KEY, id);
    setPlayerIdState(id);
    // Mark session active
    set(ref(db, `activeSessions/${id}`), {
      lastSeen: Date.now(),
      deviceId: crypto.randomUUID(),
    });
  }

  function clearPlayer() {
    localStorage.removeItem(STORAGE_KEY);
    setPlayerIdState(null);
  }

  return { playerId, selectPlayer, clearPlayer };
}
