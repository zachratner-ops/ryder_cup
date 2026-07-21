const { db } = require('./firebase');

// The admin PIN lives at admin/pin, outside the client-readable tournament node.
// Falls back to the legacy tournament/adminPin location for tournaments created
// before the move.
async function getStoredPin() {
  const snap = await db.ref('admin/pin').once('value');
  if (snap.val() != null) return String(snap.val());
  const legacy = await db.ref('tournament/adminPin').once('value');
  return legacy.val() != null ? String(legacy.val()) : null;
}

// True when the supplied PIN matches, or when no PIN is stored yet
// (pre-setup state — mirrors the old "any PIN enters setup" behaviour).
async function verifyPin(pin) {
  const stored = await getStoredPin();
  if (stored == null) return true;
  return stored === String(pin ?? '');
}

module.exports = { getStoredPin, verifyPin };
