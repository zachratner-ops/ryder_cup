const express = require('express');
const router = express.Router();
const { db } = require('../firebase');

// POST /api/tournament/setup
// Body: { name, adminPin, teamA: {name, color}, teamB: {name, color},
//         players: [{id, name, teamId, handicap}],
//         course: { name, holes: [{number, par, strokeIndex}] },
//         rounds: [{id, format, pointsValue, order}] }
router.post('/setup', async (req, res) => {
  try {
    const { name, adminPin, teamA, teamB, players, course, rounds } = req.body;

    const updates = {};

    updates['tournament/name'] = name;
    updates['tournament/status'] = 'setup';
    updates['tournament/adminPin'] = adminPin;
    updates['tournament/teamA'] = teamA;
    updates['tournament/teamB'] = teamB;

    for (const player of players) {
      updates[`players/${player.id}`] = {
        name: player.name,
        teamId: player.teamId,
        handicap: player.handicap,
      };
    }

    updates['course/name'] = course.name;
    for (const hole of course.holes) {
      updates[`course/holes/${hole.number}`] = {
        par: hole.par,
        strokeIndex: hole.strokeIndex,
      };
    }

    for (const round of rounds) {
      updates[`rounds/${round.id}`] = {
        format: round.format,
        pointsValue: round.pointsValue,
        order: round.order,
        status: 'setup',
      };
    }

    updates['leaderboard/teamA_pts'] = 0;
    updates['leaderboard/teamB_pts'] = 0;
    updates['leaderboard/ptsAvailable'] = rounds.reduce((s, r) => s + r.pointsValue, 0);
    updates['leaderboard/lastUpdated'] = Date.now();

    await db.ref().update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/tournament/status
router.get('/status', async (req, res) => {
  try {
    const snap = await db.ref('tournament').once('value');
    res.json(snap.val());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/tournament/reset — wipe all data (requires adminPin)
router.post('/reset', async (req, res) => {
  try {
    const { adminPin } = req.body;
    const snap = await db.ref('tournament/adminPin').once('value');
    if (snap.val() && snap.val() !== adminPin) {
      return res.status(403).json({ error: 'Bad PIN' });
    }
    await db.ref('/').set(null);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
