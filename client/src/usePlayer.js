import { useState } from 'react';
import { db } from './firebase';
import { ref, set } from 'firebase/database';

const PLAYER_KEY = 'ryder_playerId';
const ADMIN_KEY  = 'ryder_isAdmin';

export function usePlayer() {
  const [playerId, setPlayerIdState] = useState(() => localStorage.getItem(PLAYER_KEY));
  const [isAdmin, setIsAdminState]   = useState(() => localStorage.getItem(ADMIN_KEY) === 'true');

  function selectPlayer(id) {
    localStorage.setItem(PLAYER_KEY, id);
    localStorage.removeItem(ADMIN_KEY);
    setPlayerIdState(id);
    setIsAdminState(false);
    set(ref(db, `activeSessions/${id}`), {
      lastSeen: Date.now(),
      deviceId: crypto.randomUUID(),
    });
  }

  function activateAdmin() {
    localStorage.removeItem(PLAYER_KEY);
    localStorage.setItem(ADMIN_KEY, 'true');
    setPlayerIdState(null);
    setIsAdminState(true);
  }

  function clearPlayer() {
    localStorage.removeItem(PLAYER_KEY);
    localStorage.removeItem(ADMIN_KEY);
    setPlayerIdState(null);
    setIsAdminState(false);
  }

  return { playerId, isAdmin, selectPlayer, activateAdmin, clearPlayer };
}
