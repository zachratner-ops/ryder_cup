import { useEffect, useState, useRef, useCallback } from 'react';
import { ref, get, set, update } from 'firebase/database';
import { db } from './firebase';
import { dequeueAll, removeById, getQueueLength } from './offlineQueue';
import { computeHoleOutcome } from './holeWinner';

// App-wide offline sync: flushes queued score writes whenever connectivity
// returns — regardless of which page the user is on — and recomputes each
// affected hole's winner/status. Also tracks online + pending state to drive
// a connectivity banner. Runs safely alongside the Match page's own flush
// (writes are idempotent; removeById no-ops on already-removed items).
export function useOfflineSync() {
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [pending, setPending] = useState(0);
  const [flushing, setFlushing] = useState(false);
  const flushingRef = useRef(false);

  const refreshPending = useCallback(async () => {
    try { setPending(await getQueueLength()); } catch { /* ignore */ }
  }, []);

  const flush = useCallback(async () => {
    if (flushingRef.current) return;
    if (typeof navigator !== 'undefined' && !navigator.onLine) return;
    const items = await dequeueAll();
    if (!items.length) { setPending(0); return; }

    flushingRef.current = true;
    setFlushing(true);
    const affected = new Map(); // matchId -> Set(holeNum)
    try {
      for (const item of items) {
        try {
          await set(ref(db, item.path), item.value);
          await removeById(item.id);
          const parts = item.path.split('/'); // holes/{matchId}/{hole}/{who}
          if (parts[0] === 'holes' && parts[1] && parts[2]) {
            const holeNum = parseInt(parts[2]);
            if (!isNaN(holeNum)) {
              if (!affected.has(parts[1])) affected.set(parts[1], new Set());
              affected.get(parts[1]).add(holeNum);
            }
          }
        } catch {
          // Leave the rest queued; retry on next reconnect
          break;
        }
      }

      // Recompute hole winners for every match we touched
      for (const [matchId, holes] of affected) {
        try {
          const [mSnap, hSnap] = await Promise.all([
            get(ref(db, `matches/${matchId}`)),
            get(ref(db, `holes/${matchId}`)),
          ]);
          const match = mSnap.val();
          if (!match) continue;
          const round = match.roundId ? (await get(ref(db, `rounds/${match.roundId}`))).val() : null;
          const matchHoles = hSnap.val() || {};
          for (const holeNum of holes) {
            const outcome = computeHoleOutcome(match, round, matchHoles, holeNum);
            if (outcome) await update(ref(db, `holes/${matchId}/${holeNum}`), outcome);
          }
        } catch { /* best-effort */ }
      }
    } finally {
      flushingRef.current = false;
      setFlushing(false);
      await refreshPending();
    }
  }, [refreshPending]);

  useEffect(() => {
    function onOnline() { setOnline(true); flush(); }
    function onOffline() { setOnline(false); }
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);

    // Initial flush + a light poll so the pending count stays fresh no matter
    // which page enqueued a write.
    flush();
    const poll = setInterval(refreshPending, 4000);

    return () => {
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
      clearInterval(poll);
    };
  }, [flush, refreshPending]);

  return { online, pending, flushing, flush };
}
