const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { computeStrokeAllocation } = require('../strokeAllocation');

// POST /api/bets/nassau
// Body: { matchId, playerA, playerB, amount, createdBy }
// Creates a Nassau bet between two players in a match, computing head-to-head stroke allocation server-side.
router.post('/nassau', async (req, res) => {
  try {
    const { matchId, playerA, playerB, amount, createdBy, components, mode, teamAIds, teamBIds, pressThreshold } = req.body;

    if (!matchId || !playerA || !playerB || amount == null || !createdBy) {
      return res.status(400).json({ error: 'Missing required fields: matchId, playerA, playerB, amount, createdBy' });
    }

    const DEFAULT_COMPONENTS = [
      { label: 'Front 9', startHole: 1, endHole: 9 },
      { label: 'Back 9', startHole: 10, endHole: 18 },
      { label: 'Overall', startHole: 1, endHole: 18 },
    ];

    const resolvedComponents = (Array.isArray(components) && components.length) ? components : DEFAULT_COMPONENTS;

    // 2v2 mode: computation uses holeWinner, no player lookup or stroke allocation needed
    if (mode === '2v2') {
      const matchSnap = await db.ref(`matches/${matchId}`).once('value');
      if (!matchSnap.val()) return res.status(404).json({ error: `Match ${matchId} not found` });

      const newBet = {
        matchId,
        mode: '2v2',
        playerA: 'teamA',
        playerB: 'teamB',
        teamAIds: teamAIds || [],
        teamBIds: teamBIds || [],
        amount: parseFloat(amount),
        strokeAllocation: {},
        components: resolvedComponents,
        pressThreshold: pressThreshold ?? 2,
        createdBy,
        createdAt: Date.now(),
        status: 'active',
      };

      const betRef = db.ref('nassauBets').push();
      await betRef.set(newBet);
      return res.json({ ok: true, betId: betRef.key });
    }

    // 1v1 mode: look up players and compute stroke allocation
    if (playerA === playerB) {
      return res.status(400).json({ error: 'playerA and playerB must be different' });
    }

    const [playerASnap, playerBSnap, courseSnap, matchSnap] = await Promise.all([
      db.ref(`players/${playerA}`).once('value'),
      db.ref(`players/${playerB}`).once('value'),
      db.ref('course/holes').once('value'),
      db.ref(`matches/${matchId}`).once('value'),
    ]);

    const pA = playerASnap.val();
    const pB = playerBSnap.val();
    const match = matchSnap.val();

    if (!pA) return res.status(404).json({ error: `Player ${playerA} not found` });
    if (!pB) return res.status(404).json({ error: `Player ${playerB} not found` });
    if (!match) return res.status(404).json({ error: `Match ${matchId} not found` });

    const holesRaw = courseSnap.val() || {};
    const courseHoles = Object.entries(holesRaw).map(([num, data]) => ({
      number: parseInt(num),
      ...data,
    }));

    const strokeAllocation = computeStrokeAllocation(
      [
        { id: playerA, handicap: pA.handicap || 0 },
        { id: playerB, handicap: pB.handicap || 0 },
      ],
      courseHoles,
      'singles'
    );

    const newBet = {
      matchId,
      playerA,
      playerB,
      amount: parseFloat(amount),
      strokeAllocation,
      components: resolvedComponents,
      pressThreshold: pressThreshold ?? 2,
      createdBy,
      createdAt: Date.now(),
      status: 'active',
    };

    const betRef = db.ref('nassauBets').push();
    await betRef.set(newBet);

    res.json({ ok: true, betId: betRef.key });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
