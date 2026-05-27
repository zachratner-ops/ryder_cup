import { useState, useEffect } from 'react';
import { ref, onValue } from 'firebase/database';
import { db } from './firebase';

// Generic hook: subscribe to a Firebase path, return live value
export function useFirebaseValue(path) {
  const [value, setValue] = useState(undefined);

  useEffect(() => {
    if (!path) return;
    const r = ref(db, path);
    const unsub = onValue(r, (snap) => setValue(snap.val()));
    return () => unsub();
  }, [path]);

  return value;
}
