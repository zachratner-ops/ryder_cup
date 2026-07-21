const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { verifyPin } = require('../adminPin');
const { computeStrokeAllocation } = require('../strokeAllocation');
const { computeMatchResult } = require('../scoring');

// Build the Firebase updates that (re)create a round's matches with the given
// status ('staged' or 'active'). Any existing matches for the round — e.g. a
// previous staging — are replaced, along with any stray hole data.
async function buildMatchUpdates(roundId, round, matchDefs, carrierOrder, matchStatus) {
  const [playersSnap, courseSnap, existingSnap] = await Promise.all([
    db.ref('players').once('value'),
    db.ref('course/holes').once('value'),
    db.ref('matches').orderByChild('roundId').equalTo(roundId).once('value'),
  ]);

  const playersMap = playersSnap.val() || {};
  const holesRaw = courseSnap.val() || {};
  const courseHoles = Object.entries(holesRaw).map(([num, data]) => ({
    number: parseInt(num),
    ...data,
  }));

  const updates = {};
  for (const key of Object.keys(existingSnap.val() || {})) {
    updates[`matches/${key}`] = null;
    updates[`holes/${key}`] = null;
  }

  if (carrierOrder) {
    updates[`rounds/${roundId}/carrierOrder`] = carrierOrder;
  }

  for (const match of matchDefs) {
    // Support both { playerIds: [] } and raw array formats
    const teamAIds = Array.isArray(match.teamA) ? match.teamA : (match.teamA?.playerIds || []);
    const teamBIds = Array.isArray(match.teamB) ? match.teamB : (match.teamB?.playerIds || []);

    let strokeAllocation;
    if (round.format === 'scramble') {
      // Scramble: no handicaps, team gross only
      strokeAllocation = {};
    } else if (round.format === 'foursomes') {
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
      ...(round.format === 'scramble' ? { holeCount: round.holeCount === 9 ? 9 : 18 } : {}),
      status: matchStatus,
      result: null,
    };
  }

  return updates;
}

// POST /api/rounds/:roundId/stage
// Body: { adminPin, matches: [{ matchId, teamA: {playerIds}, teamB: {playerIds} }] }
//       For yellowball: { carrierOrder: { teamA: [...], teamB: [...] } }
// Saves pairings as staged matches — visible but locked for scoring — so they
// can be reviewed and edited before the round goes live. Re-staging replaces
// the previous staging.
router.post('/:roundId/stage', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin, matches, carrierOrder } = req.body;

    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'setup' && round.status !== 'staged') {
      return res.status(400).json({ error: 'Round has already started' });
    }
    if (!Array.isArray(matches) || !matches.length) {
      return res.status(400).json({ error: 'No pairings supplied' });
    }

    const updates = await buildMatchUpdates(roundId, round, matches, carrierOrder, 'staged');
    updates[`rounds/${roundId}/status`] = 'staged';

    await db.ref().update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:roundId/unstage
// Body: { adminPin }
// Deletes the staged matches and returns the round to setup.
router.post('/:roundId/unstage', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin } = req.body;

    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'staged') return res.status(400).json({ error: 'Round is not staged' });

    const matchesSnap = await db.ref('matches').orderByChild('roundId').equalTo(roundId).once('value');
    const updates = {};
    for (const key of Object.keys(matchesSnap.val() || {})) {
      updates[`matches/${key}`] = null;
      updates[`holes/${key}`] = null;
    }
    updates[`rounds/${roundId}/status`] = 'setup';

    await db.ref().update(updates);
    res.json({ ok: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

// POST /api/rounds/:roundId/start
// Body: { adminPin, matches?: [{ matchId, teamA: {playerIds}, teamB: {playerIds} }] }
//       For yellowball: { carrierOrder: { teamA: [playerId,...], teamB: [playerId,...] } }
// With pairings in the body, (re)creates the matches live — replacing any
// staged ones, so last-minute edits apply. Without pairings, activates the
// round's previously staged matches as-is.
router.post('/:roundId/start', async (req, res) => {
  try {
    const { roundId } = req.params;
    const { adminPin, matches, carrierOrder } = req.body;

    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });

    let updates;
    if (Array.isArray(matches) && matches.length) {
      updates = await buildMatchUpdates(roundId, round, matches, carrierOrder, 'active');
    } else {
      // No pairings supplied — promote staged matches
      const stagedSnap = await db.ref('matches').orderByChild('roundId').equalTo(roundId).once('value');
      const staged = stagedSnap.val() || {};
      if (!Object.keys(staged).length) {
        return res.status(400).json({ error: 'No pairings supplied and no staged matches to start' });
      }
      updates = {};
      for (const key of Object.keys(staged)) {
        updates[`matches/${key}/status`] = 'active';
      }
    }

    updates[`rounds/${roundId}/status`] = 'active';
    updates[`tournament/status`] = 'active';

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

    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

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

    for (const [matchId, match] of Object.entries(matches)) {
      const outcome = computeMatchResult(match, allHoles[matchId] || {}, round);
      updates[`matches/${matchId}/result`] = outcome.result;
      updates[`matches/${matchId}/status`] = 'complete';
      teamA_pts += outcome.teamA_pts;
      teamB_pts += outcome.teamB_pts;
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
  if (format === 'yellowball' || format === 'scramble') return 1;
  if (format === 'singles') return 4;
  return 2; // fourball, foursomes
}

// pointsValue is per-match; read stored matchCount if present, else fall back to format default.
// Segment-scored fourball rounds carry front/back/overall points per match instead.
function roundTotalPts(r) {
  const count = r.matchCount != null ? r.matchCount : defaultMatchCount(r.format);
  if (r.format === 'fourball' && r.segmentPoints) {
    const perMatch =
      (parseFloat(r.segmentPoints.front) || 0) +
      (parseFloat(r.segmentPoints.back) || 0) +
      (parseFloat(r.segmentPoints.overall) || 0);
    return perMatch * count;
  }
  const perMatch = parseFloat(r.pointsValue) || 0;
  return perMatch * count;
}

// Normalise optional per-format round config from the request body.
// Returns { segmentPoints, holeCount } with nulls where not applicable.
function roundExtras(format, body) {
  const extras = { segmentPoints: null, holeCount: null };
  if (format === 'fourball' && body.segmentPoints) {
    extras.segmentPoints = {
      front: parseFloat(body.segmentPoints.front) || 0,
      back: parseFloat(body.segmentPoints.back) || 0,
      overall: parseFloat(body.segmentPoints.overall) || 0,
    };
  }
  if (format === 'scramble') {
    extras.holeCount = parseInt(body.holeCount) === 9 ? 9 : 18;
  }
  return extras;
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
    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

    const roundsSnap = await db.ref('rounds').once('value');
    const rounds = roundsSnap.val() || {};
    const maxOrder = Object.values(rounds).reduce((max, r) => Math.max(max, r.order || 0), 0);
    const newOrder = maxOrder + 1;
    const newRoundId = `round${newOrder}_${Date.now()}`;
    const pts = parseFloat(pointsValue) || 1;
    const fmt = format || 'fourball';
    const count = (matchCount != null && fmt !== 'yellowball' && fmt !== 'scramble')
      ? parseInt(matchCount) || defaultMatchCount(fmt)
      : defaultMatchCount(fmt);
    const extras = roundExtras(fmt, req.body);

    const newRound = { format: fmt, pointsValue: pts, matchCount: count, order: newOrder, status: 'setup', ...extras };
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

    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'setup' && round.status !== 'staged') {
      return res.status(400).json({ error: 'Can only edit rounds before they start' });
    }
    if (round.status === 'staged' && format !== round.format) {
      return res.status(400).json({ error: 'Unstage the round before changing its format' });
    }

    const pts = parseFloat(pointsValue) || 1;
    const count = (matchCount != null && format !== 'yellowball' && format !== 'scramble')
      ? parseInt(matchCount) || defaultMatchCount(format)
      : defaultMatchCount(format);
    const extras = roundExtras(format, req.body);
    const updatedRound = { ...round, format, pointsValue: pts, matchCount: count, ...extras };
    const updates = {};
    updates[`rounds/${roundId}/format`] = format;
    updates[`rounds/${roundId}/pointsValue`] = pts;
    updates[`rounds/${roundId}/matchCount`] = count;
    updates[`rounds/${roundId}/segmentPoints`] = extras.segmentPoints;
    updates[`rounds/${roundId}/holeCount`] = extras.holeCount;
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

    if (!(await verifyPin(adminPin))) return res.status(403).json({ error: 'Bad PIN' });

    const roundSnap = await db.ref(`rounds/${roundId}`).once('value');
    const round = roundSnap.val();
    if (!round) return res.status(404).json({ error: 'Round not found' });
    if (round.status !== 'setup' && round.status !== 'staged') {
      return res.status(400).json({ error: 'Can only delete rounds before they start' });
    }

    const updates = {};
    updates[`rounds/${roundId}`] = null;
    // Remove any staged matches belonging to this round
    const matchesSnap = await db.ref('matches').orderByChild('roundId').equalTo(roundId).once('value');
    for (const key of Object.keys(matchesSnap.val() || {})) {
      updates[`matches/${key}`] = null;
      updates[`holes/${key}`] = null;
    }
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
