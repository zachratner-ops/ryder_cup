const express = require('express');
const router = express.Router();
const { db } = require('../firebase');
const { computeStrokeAllocation } = require('../strokeAllocation');

const COURSE_HOLES = [
  { number: 1,  par: 4, strokeIndex: 7  },
  { number: 2,  par: 5, strokeIndex: 9  },
  { number: 3,  par: 4, strokeIndex: 5  },
  { number: 4,  par: 3, strokeIndex: 11 },
  { number: 5,  par: 4, strokeIndex: 13 },
  { number: 6,  par: 4, strokeIndex: 1  },
  { number: 7,  par: 3, strokeIndex: 15 },
  { number: 8,  par: 5, strokeIndex: 17 },
  { number: 9,  par: 4, strokeIndex: 3  },
  { number: 10, par: 4, strokeIndex: 2  },
  { number: 11, par: 5, strokeIndex: 10 },
  { number: 12, par: 3, strokeIndex: 14 },
  { number: 13, par: 4, strokeIndex: 8  },
  { number: 14, par: 5, strokeIndex: 12 },
  { number: 15, par: 4, strokeIndex: 6  },
  { number: 16, par: 4, strokeIndex: 18 },
  { number: 17, par: 3, strokeIndex: 16 },
  { number: 18, par: 4, strokeIndex: 4  },
];

const PLAYERS = [
  { id: 'player1', name: 'Zach',    teamId: 'teamA', handicap: 9  },
  { id: 'player2', name: 'Matt',    teamId: 'teamA', handicap: 15 },
  { id: 'player3', name: 'Jared',   teamId: 'teamA', handicap: 4  },
  { id: 'player4', name: 'Ben',     teamId: 'teamA', handicap: 7  },
  { id: 'player5', name: 'Justin',  teamId: 'teamB', handicap: 3  },
  { id: 'player6', name: 'Ryan',    teamId: 'teamB', handicap: 12 },
  { id: 'player7', name: 'Brother', teamId: 'teamB', handicap: 18 },
  { id: 'player8', name: 'Dan',     teamId: 'teamB', handicap: 6  },
];

// POST /api/seed — wipe and seed a full test tournament
router.post('/', async (req, res) => {
  try {
    await db.ref('/').set(null);

    const updates = {};

    // Tournament
    updates['tournament/name'] = 'GrayBull Ryder Cup';
    updates['tournament/status'] = 'active';
    updates['tournament/adminPin'] = '1234';
    updates['tournament/teamA'] = { name: 'Northwestern', color: '#4E2A84' };
    updates['tournament/teamB'] = { name: 'Nebraska',     color: '#D00000' };

    // Players
    for (const p of PLAYERS) {
      updates[`players/${p.id}`] = { name: p.name, teamId: p.teamId, handicap: p.handicap };
    }

    // Course
    updates['course/name'] = 'GrayBull Club';
    for (const h of COURSE_HOLES) {
      updates[`course/holes/${h.number}`] = { par: h.par, strokeIndex: h.strokeIndex };
    }

    // Rounds
    updates['rounds/round1'] = { format: 'fourball', pointsValue: 1, order: 1, status: 'active' };
    updates['rounds/round2'] = { format: 'fourball', pointsValue: 1, order: 2, status: 'setup'  };
    updates['rounds/round3'] = { format: 'singles',  pointsValue: 2, order: 3, status: 'setup'  };

    // Matches for round 1 — two four-ball matches
    const match1Players = [
      { id: 'player1', handicap: 9  },
      { id: 'player2', handicap: 15 },
      { id: 'player5', handicap: 3  },
      { id: 'player6', handicap: 12 },
    ];
    const match2Players = [
      { id: 'player3', handicap: 4  },
      { id: 'player4', handicap: 7  },
      { id: 'player7', handicap: 18 },
      { id: 'player8', handicap: 6  },
    ];

    const alloc1 = computeStrokeAllocation(match1Players, COURSE_HOLES, 'fourball');
    const alloc2 = computeStrokeAllocation(match2Players, COURSE_HOLES, 'fourball');

    updates['matches/match1'] = {
      roundId: 'round1', format: 'fourball',
      teamA: { playerIds: ['player1', 'player2'] },
      teamB: { playerIds: ['player5', 'player6'] },
      strokeAllocation: alloc1, status: 'active', result: null,
    };
    updates['matches/match2'] = {
      roundId: 'round1', format: 'fourball',
      teamA: { playerIds: ['player3', 'player4'] },
      teamB: { playerIds: ['player7', 'player8'] },
      strokeAllocation: alloc2, status: 'active', result: null,
    };

    // Seed 6 holes of scores for match1
    const match1Scores = [
      // [holeNum, p1gross, p2gross, p5gross, p6gross]
      [1, 5, 6, 4, 5],
      [2, 6, 7, 6, 6],
      [3, 4, 5, 4, 4],
      [4, 3, 4, 3, 4],
      [5, 5, 5, 4, 6],
      [6, 5, 6, 5, 5],
    ];

    for (const [hole, g1, g2, g5, g6] of match1Scores) {
      const holeData = COURSE_HOLES[hole - 1];
      const isPar3 = holeData.par === 3;

      const score = (pid, gross, alloc) => ({
        gross,
        net: gross - (alloc[pid]?.holes?.includes(hole) ? 1 : 0),
        fairwayHit: isPar3 ? null : gross <= holeData.par,
        gir: gross <= holeData.par + 1,
        putts: gross <= holeData.par ? 1 : 2,
      });

      const s1 = score('player1', g1, alloc1);
      const s2 = score('player2', g2, alloc1);
      const s5 = score('player5', g5, alloc1);
      const s6 = score('player6', g6, alloc1);

      const bestA = Math.min(s1.net, s2.net);
      const bestB = Math.min(s5.net, s6.net);
      const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';

      updates[`holes/match1/${hole}/player1`] = s1;
      updates[`holes/match1/${hole}/player2`] = s2;
      updates[`holes/match1/${hole}/player5`] = s5;
      updates[`holes/match1/${hole}/player6`] = s6;
      updates[`holes/match1/${hole}/holeWinner`] = winner;
    }

    // Leaderboard
    updates['leaderboard/teamA_pts'] = 0;
    updates['leaderboard/teamB_pts'] = 0;
    updates['leaderboard/ptsAvailable'] = 4;
    updates['leaderboard/lastUpdated'] = Date.now();

    await db.ref().update(updates);
    res.json({ ok: true, adminPin: '1234' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
