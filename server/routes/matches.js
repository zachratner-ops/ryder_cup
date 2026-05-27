const express = require('express');
const router = express.Router();
const { db } = require('../firebase');

// POST /api/matches/:matchId/correct
// Admin score correction
// Body: { adminPin, playerId, holeNumber, gross, fairwayHit, gir, putts }
router.post('/:matchId/correct', async (req, res) => {
  try {
    const { matchId } = req.params;
    const { adminPin, playerId, holeNumber, gross, fairwayHit, gir, putts } = req.body;

    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    // Load stroke allocation to recompute net
    const matchSnap = await db.ref(`matches/${matchId}`).once('value');
    const match = matchSnap.val();
    if (!match) return res.status(404).json({ error: 'Match not found' });

    const allocation = match.strokeAllocation?.[playerId]?.holes || [];
    const net = gross - (allocation.includes(holeNumber) ? 1 : 0);

    const holeRef = db.ref(`holes/${matchId}/${holeNumber}/${playerId}`);
    await holeRef.update({ gross, net, fairwayHit: fairwayHit ?? null, gir, putts });

    res.json({ ok: true, net });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
