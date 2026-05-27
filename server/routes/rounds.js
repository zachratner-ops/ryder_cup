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

// Helper: recalculate ptsAvailable from all rounds minus already-awarded points
async function recalcPtsAvailable(extraRounds = {}) {
  const [roundsSnap, lbSnap] = await Promise.all([
    db.ref('rounds').once('value'),
    db.ref('leaderboard').once('value'),
  ]);
  const rounds = { ...roundsSnap.val(), ...extraRounds };
  const lb = lbSnap.val() || {};
  const totalRoundPts = Object.values(rounds)
    .filter((r) => r !== null)
    .reduce((sum, r) => sum + (parseFloat(r.pointsValue) || 0), 0);
  const awarded = (lb.teamA_pts || 0) + (lb.teamB_pts || 0);
  return Math.max(0, totalRoundPts - awarded);
}

// POST /api/rounds/add
// Body: { adminPin, format, pointsValue }
router.post('/add', async (req, res) => {
  try {
    const { adminPin, format, pointsValue } = req.body;
    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    const roundsSnap = await db.ref('rounds').once('value');
    const rounds = roundsSnap.val() || {};
    const maxOrder = Object.values(rounds).reduce((max, r) => Math.max(max, r.order || 0), 0);
    const newOrder = maxOrder + 1;
    const newRoundId = `round${newOrder}_${Date.now()}`;
    const pts = parseFloat(pointsValue) || 1;

    const newRound = { format: format || 'fourball', pointsValue: pts, order: newOrder, status: 'setup' };
    const updates = {};
    updates[`rounds/${newRoundId}`] = newRound;
    updates['leaderboard/ptsAvailable'] = await recalcPtsAvailable({ [newRoundId]: newRound });

    await db.ref().update(updates);
    res.json({ ok: true, roundId: newRoundId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:roundId/update
// Body: { adminPin, format, pointsValue }
router.post('/:roundId/update', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin, format, pointsValue } = req.body;

    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'setup') return res.status(400).json({ error: 'Can only edit rounds in setup status' });

    const pts = parseFloat(pointsValue) || 1;
    const updatedRound = { ...round, format, pointsValue: pts };
    const updates = {};
    updates[`rounds/${roundId}/format`] = format;
    updates[`rounds/${roundId}/pointsValue`] = pts;
    updates['leaderboard/ptsAvailable'] = await recalcPtsAvailable({ [roundId]: updatedRound });

    await db.ref().update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:roundId/delete
// Body: { adminPin }
router.post('/:roundId/delete', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin } = req.body;

    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'setup') return res.status(400).json({ error: 'Can only delete rounds in setup status' });

    const updates = {};
    updates[`rounds/${roundId}`] = null;
    // Pass null to exclude this round from recalc
    updates['leaderboard/ptsAvailable'] = await recalcPtsAvailable({ [roundId]: null });

    await db.ref().update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
