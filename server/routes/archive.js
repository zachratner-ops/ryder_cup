const express = require('express');
const router = express.Router();
const { db } = require('../firebase');

// POST /api/tournament/archive
// Body: { adminPin, reset?: boolean }
// Snapshots the current tournament into tournamentArchives/{id}
// If reset=true, wipes all data afterward for a fresh tournament
router.post('/', async (req, res) => {
  try {
    const { adminPin, reset = false } = req.body;

    // Verify PIN
    const pinSnap = await db.ref('tournament/adminPin').once('value');
    const storedPin = pinSnap.val();
    if (storedPin && storedPin !== adminPin) {
      return res.status(403).json({ error: 'Bad PIN' });
    }

    // Read all data in parallel
    const [tournSnap, playersSnap, roundsSnap, matchesSnap, holesSnap, lbSnap] = await Promise.all([
      db.ref('tournament').once('value'),
      db.ref('players').once('value'),
      db.ref('rounds').once('value'),
      db.ref('matches').once('value'),
      db.ref('holes').once('value'),
      db.ref('leaderboard').once('value'),
    ]);

    const tournament = tournSnap.val();
    const players = playersSnap.val() || {};
    const rounds = roundsSnap.val() || {};
    const matches = matchesSnap.val() || {};
    const holes = holesSnap.val() || {};
    const leaderboard = lbSnap.val() || {};

    if (!tournament?.name) {
      return res.status(400).json({ error: 'No tournament to archive' });
    }

    // Build rounds summary (sorted by round order)
    const roundsSummary = Object.entries(rounds)
      .sort(([, a], [, b]) => a.order - b.order)
      .map(([roundId, round]) => ({
        roundId,
        format: round.format,
        order: round.order,
        pointsValue: round.pointsValue,
        status: round.status,
        teamA_pts: leaderboard.rounds?.[roundId]?.teamA_pts ?? 0,
        teamB_pts: leaderboard.rounds?.[roundId]?.teamB_pts ?? 0,
      }));

    // Build matches summary
    const matchesSummary = Object.entries(matches).map(([matchId, match]) => {
      const matchHoles = holes[matchId] || {};

      // Find the last hole's matchStatus string for the final result display
      let finalStatus = null;
      for (let h = 18; h >= 1; h--) {
        if (matchHoles[h]?.matchStatus) {
          finalStatus = matchHoles[h].matchStatus;
          break;
        }
      }

      const teamANames = (match.teamA?.playerIds || []).map(
        (id) => players[id]?.name?.split(' ')[0] || id
      );
      const teamBNames = (match.teamB?.playerIds || []).map(
        (id) => players[id]?.name?.split(' ')[0] || id
      );

      return {
        matchId,
        roundId: match.roundId,
        format: match.format,
        teamAPlayerNames: teamANames,
        teamBPlayerNames: teamBNames,
        result: match.result || null,
        finalStatus,
      };
    });

    // Compact player snapshot (just what's useful for history display)
    const playersSummary = {};
    for (const [id, p] of Object.entries(players)) {
      playersSummary[id] = { name: p.name, teamId: p.teamId, handicap: p.handicap };
    }

    const archiveId = `archive_${Date.now()}`;
    const archive = {
      name: tournament.name,
      archivedAt: Date.now(),
      teamA: {
        name: tournament.teamA?.name || 'Team A',
        color: tournament.teamA?.color || '#4E2A84',
        finalPts: leaderboard.teamA_pts ?? 0,
      },
      teamB: {
        name: tournament.teamB?.name || 'Team B',
        color: tournament.teamB?.color || '#dc2626',
        finalPts: leaderboard.teamB_pts ?? 0,
      },
      rounds: roundsSummary,
      matches: matchesSummary,
      players: playersSummary,
    };

    // Write archive
    await db.ref(`tournamentArchives/${archiveId}`).set(archive);

    // Optionally wipe the current tournament for a fresh start
    if (reset) {
      await db.ref('/').set(null);
    }

    res.json({ ok: true, archiveId });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
