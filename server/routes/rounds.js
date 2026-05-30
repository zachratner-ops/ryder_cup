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

      let strokeAllocation;
      if (round.format === 'foursomes') {
        // Foursomes: one allocation per pair keyed by 'teamA'/'teamB', handicap = combined / 2
        const combinedHcpA = teamAIds.reduce((s, id) => s + (playersMap[id]?.handicap || 0), 0) / 2;
        const combinedHcpB = teamBIds.reduce((s, id) => s + (playersMap[id]?.handicap || 0), 0) / 2;
        strokeAllocation = computeStrokeAllocation(
          [{ id: 'teamA', combinedHcp: Math.round(combinedHcpA) }, { id: 'teamB', combinedHcp: Math.round(combinedHcpB) }],
          courseHoles,
          'foursomes'
        );
      } else {
        const allPlayerIds = [...teamAIds, ...teamBIds];
        const matchPlayers = allPlayerIds.map((id) => ({ id, ...playersMap[id] }));
        strokeAllocation = computeStrokeAllocation(matchPlayers, courseHoles, round.format);
      }

      updates[`matches/${match.matchId}`] = {
        roundId,
        format: round.format,
        teamA: { playerIds: teamAIds },
        teamB: { playerIds: teamBIds },
        strokeAllocation,
        ...(round.format === 'yellowball' && carrierOrder ? { carrierOrder } : {}),
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

    // Fetch matches, round config, and hole-by-hole data in parallel
    const [matchesSnap, roundSnap, holesSnap] = await Promise.all([
      db.ref('matches').orderByChild('roundId').equalTo(roundId).once('value'),
      db.ref(`rounds/${roundId}`).once('value'),
      db.ref('holes').once('value'),
    ]);
    const matches = matchesSnap.val() || {};
    const round = roundSnap.val();
    const allHoles = holesSnap.val() || {};

    let teamA_pts = 0;
    let teamB_pts = 0;

    const updates = {};
    const pts = parseFloat(round?.pointsValue) || 1;

    for (const [matchId, match] of Object.entries(matches)) {
      const matchHoles = allHoles[matchId] || {};
      let winner;

      if (match.format === 'yellowball') {
        // Lower cumulative net yellow-ball score wins
        let cumA = 0, cumB = 0;
        for (let h = 1; h <= 18; h++) {
          if (matchHoles[h]?.ybNetA != null) cumA += matchHoles[h].ybNetA;
          if (matchHoles[h]?.ybNetB != null) cumB += matchHoles[h].ybNetB;
        }
        winner = cumA < cumB ? 'teamA' : cumA > cumB ? 'teamB' : 'half';
      } else {
        // Match play: team with more holes won takes the match
        let aHoles = 0, bHoles = 0;
        for (let h = 1; h <= 18; h++) {
          const hw = matchHoles[h]?.holeWinner;
          if (hw === 'teamA') aHoles++;
          else if (hw === 'teamB') bHoles++;
        }
        winner = aHoles > bHoles ? 'teamA' : bHoles > aHoles ? 'teamB' : 'half';
      }

      updates[`matches/${matchId}/result`] = { winner, points: pts };
      updates[`matches/${matchId}/status`] = 'complete';

      if (winner === 'teamA') teamA_pts += pts;
      else if (winner === 'teamB') teamB_pts += pts;
      else { teamA_pts += pts / 2; teamB_pts += pts / 2; }
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

// Default match count when not explicitly stored on the round
function defaultMatchCount(format) {
  if (format === 'yellowball') return 1;
  if (format === 'singles') return 4;
  return 2; // fourball, foursomes
}

// pointsValue is per-match; read stored matchCount if present, else fall back to format default
function roundTotalPts(r) {
  const perMatch = parseFloat(r.pointsValue) || 0;
  const count = r.matchCount != null ? r.matchCount : defaultMatchCount(r.format);
  return perMatch * count;
}

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
    .reduce((sum, r) => sum + roundTotalPts(r), 0);
  const awarded = (lb.teamA_pts || 0) + (lb.teamB_pts || 0);
  return Math.max(0, totalRoundPts - awarded);
}

// POST /api/rounds/add
// Body: { adminPin, format, pointsValue, matchCount? }
router.post('/add', async (req, res) => {
  try {
    const { adminPin, format, pointsValue, matchCount } = req.body;
    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    const roundsSnap = await db.ref('rounds').once('value');
    const rounds = roundsSnap.val() || {};
    const maxOrder = Object.values(rounds).reduce((max, r) => Math.max(max, r.order || 0), 0);
    const newOrder = maxOrder + 1;
    const newRoundId = `round${newOrder}_${Date.now()}`;
    const pts = parseFloat(pointsValue) || 1;
    const fmt = format || 'fourball';
    const count = (matchCount != null && format !== 'yellowball')
      ? parseInt(matchCount) || defaultMatchCount(fmt)
      : defaultMatchCount(fmt);

    const newRound = { format: fmt, pointsValue: pts, matchCount: count, order: newOrder, status: 'setup' };
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
// Body: { adminPin, format, pointsValue, matchCount? }
router.post('/:roundId/update', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin, format, pointsValue, matchCount } = req.body;

    const tournSnap = await db.ref('tournament').once('value');
    if (tournSnap.val().adminPin !== adminPin) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'setup') return res.status(400).json({ error: 'Can only edit rounds in setup status' });

    const pts = parseFloat(pointsValue) || 1;
    const count = (matchCount != null && format !== 'yellowball')
      ? parseInt(matchCount) || defaultMatchCount(format)
      : defaultMatchCount(format);
    const updatedRound = { ...round, format, pointsValue: pts, matchCount: count };
    const updates = {};
    updates[`rounds/${roundId}/format`] = format;
    updates[`rounds/${roundId}/pointsValue`] = pts;
    updates[`rounds/${roundId}/matchCount`] = count;
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
