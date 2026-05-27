const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { computeStrokeAllocation } = require('../strokeAllocation');

// POST /api/rounds/:roundId/start
// Body: { adminPin, matches: [{ matchId, teamA: {playerIds}, teamB: {playerIds} }] }
//       For yellowball: { carrierOrder: { teamA: [playerId,...], teamB: [playerId,...] } }
router.post('/:roundId/start', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin, matches, carrierOrder } = req.body;

    const tournSnap = await db.ref('tournament').once('value');
    const tourn = tournSnap.val();
    if (tourn.adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });

    const [playersSnap, courseSnap] = await Promise.all([
      db.ref('players').once('value'),
      db.ref('course/holes').once('value'),
    ]);

    const playersMap = playersSnap.val() || {};
    const holesRaw = courseSnap.val() || {};
    const courseHoles = Object.entries(holesRaw).map(([num, data]) => ({
      number: parseInt(num),
      ...data,
    }));

    const updates = {};
    updates[`rounds/${roundId}/status`] = 'active';
    updates[`tournament/status`] = 'active';

    if (carrierOrder) {
      updates[`rounds/${roundId}/carrierOrder`] = carrierOrder;
    }

    for (const match of matches) {
      // Support both { playerIds: [] } and raw array formats
      const teamAIds = Array.isArray(match.teamA) ? match.teamA : (match.teamA?.playerIds || []);
      const teamBIds = Array.isArray(match.teamB) ? match.teamB : (match.teamB?.playerIds || []);
      const allPlayerIds = [...teamAIds, ...teamBIds];
      const matchPlayers = allPlayerIds.map((id) => ({ id, ...playersMap[id] }));

      const strokeAllocation = computeStrokeAllocation(matchPlayers, courseHoles, round.format);

      updates[`matches/${match.matchId}`] = {
        roundId,
        format: round.format,
        teamA: { playerIds: teamAIds },
        teamB: { playerIds: teamBIds },
        strokeAllocation,
        status: 'active',
        result: null,
      };
    }

    await db.ref().update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:roundId/close
// Body: { adminPin }
router.post('/:roundId/close', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin } = req.body;

    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    // Fetch all matches for this round
    const matchesSnap = await db.ref('matches').orderByChild('roundId').equalTo(roundId).once('value');
    const matches = matchesSnap.val() || {};

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();

    let teamA_pts = 0;
    let teamB_pts = 0;

    const updates = {};

    for (const [matchId, match] of Object.entries(matches)) {
      if (match.result) {
        if (match.result.winner === 'teamA') teamA_pts += match.result.points;
        else if (match.result.winner === 'teamB') teamB_pts += match.result.points;
        else {
          // half — split points
          teamA_pts += match.result.points / 2;
          teamB_pts += match.result.points / 2;
        }
      }
      updates[`matches/${matchId}/status`] = 'complete';
    }

    updates[`rounds/${roundId}/status`] = 'complete';
    updates[`leaderboard/rounds/${roundId}`] = {
      teamA_pts,
      teamB_pts,
      status: 'complete',
    };

    // Increment overall leaderboard
    const lbSnap = await db.ref('leaderboard').once('value');
    const lb = lbSnap.val() || {};
    updates['leaderboard/teamA_pts'] = (lb.teamA_pts || 0) + teamA_pts;
    updates['leaderboard/teamB_pts'] = (lb.teamB_pts || 0) + teamB_pts;
    updates['leaderboard/lastUpdated'] = Date.now();

    await db.ref().update(updates);
    res.json({ ok: true, teamA_pts, teamB_pts });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
