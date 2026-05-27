const express = require('express');
const router = express.Router();
const { db } = require('../firebase');

// ── Course & Players ────────────────────────────────────────────────────────

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

const PM = Object.fromEntries(PLAYERS.map(p => [p.id, p]));

// ── Helpers ─────────────────────────────────────────────────────────────────

// Stroke allocation for fourball / singles: each player vs the match minimum handicap.
function buildAlloc(playerIds) {
  const minHcp = Math.min(...playerIds.map(id => PM[id].handicap));
  const bySI = [...COURSE_HOLES].sort((a, b) => a.strokeIndex - b.strokeIndex);
  const alloc = {};
  for (const id of playerIds) {
    const strokes = PM[id].handicap - minHcp;
    alloc[id] = { holes: bySI.slice(0, strokes).map(h => h.number) };
  }
  return alloc;
}

// Deterministic gross score: varies by player seed, hole index, and handicap.
// Produces a realistic spread without using Math.random().
function gross(par, hcp, seed, hi /* hole index 0-17 */) {
  // Two-component pseudo-noise so consecutive holes differ and rounds differ
  const noise = ((seed * 17 + hi * 13) % 9) - 3;   // -3..5, integer
  const clamped = Math.max(-1, Math.min(3, noise));  // -1..3 (birdie to triple)
  // Base strokes over par grows with handicap
  const base = hcp <= 5 ? 0 : hcp <= 10 ? 1 : hcp <= 15 ? 2 : 3;
  // Low-hcp players shifted a stroke lower so they make more birdies
  const adj = hcp <= 6 ? clamped - 1 : clamped;
  return Math.max(par - 1, par + base + adj);        // floor at birdie
}

// Running match-play status string after a given diff / holes played.
function statusStr(diff, played) {
  if (played === 0) return 'All Square';
  const rem = 18 - played;
  if (diff === 0) return `All Square thru ${played}`;
  const m = Math.abs(diff);
  return m > rem ? `${m}UP (closed)` : `${m}UP thru ${played}`;
}

// Award points for a match result.
function pts(winner, value) {
  if (winner === 'teamA') return { a: value, b: 0 };
  if (winner === 'teamB') return { a: 0, b: value };
  return { a: value / 2, b: value / 2 };
}

// ── Match hole builders ──────────────────────────────────────────────────────

// Fourball / Singles / Foursomes (seeded as fourball).
// matchSeed: unique integer per match to diversify score patterns across rounds.
// n: holes to generate data for (18 = complete, <18 = in-progress).
// Returns the match winner: 'teamA' | 'teamB' | 'half'.
function buildBallHoles(u, matchId, teamAIds, teamBIds, alloc, matchSeed, n = 18) {
  const allIds = [...teamAIds, ...teamBIds];

  // Pre-generate all gross scores
  const scores = {};
  allIds.forEach((pid, pos) => {
    scores[pid] = COURSE_HOLES.slice(0, n).map(({ par }, hi) =>
      gross(par, PM[pid].handicap, matchSeed * 31 + pos * 7, hi)
    );
  });

  let diff = 0, played = 0;
  for (let h = 1; h <= n; h++) {
    const { par } = COURSE_HOLES[h - 1];
    const isPar3 = par === 3;
    const holeObj = {};

    allIds.forEach(pid => {
      const g = scores[pid][h - 1];
      const net = g - (alloc[pid]?.holes?.includes(h) ? 1 : 0);
      holeObj[pid] = {
        gross: g,
        net,
        fairwayHit: isPar3 ? null : g <= par,
        gir: g <= par + 1,
        putts: net <= par ? 1 : 2,
      };
    });

    const bestA = Math.min(...teamAIds.map(id => holeObj[id].net));
    const bestB = Math.min(...teamBIds.map(id => holeObj[id].net));
    const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';
    if (winner === 'teamA') diff++;
    else if (winner === 'teamB') diff--;
    played++;

    holeObj.holeWinner = winner;
    holeObj.matchStatus = statusStr(diff, played);
    u[`holes/${matchId}/${h}`] = holeObj;
  }

  return diff > 0 ? 'teamA' : diff < 0 ? 'teamB' : 'half';
}

// Yellow Ball — net = gross (no handicap). Returns the cumulative winner.
function buildYBHoles(u, matchId, teamAIds, teamBIds, carrierA, carrierB, matchSeed, n = 18) {
  const allIds = [...teamAIds, ...teamBIds];

  const scores = {};
  allIds.forEach((pid, pos) => {
    scores[pid] = COURSE_HOLES.slice(0, n).map(({ par }, hi) =>
      gross(par, PM[pid].handicap, matchSeed * 31 + pos * 7, hi)
    );
  });

  let cumA = 0, cumB = 0;
  for (let h = 1; h <= n; h++) {
    const { par } = COURSE_HOLES[h - 1];
    const isPar3 = par === 3;
    const cA = carrierA[(h - 1) % carrierA.length];
    const cB = carrierB[(h - 1) % carrierB.length];
    const holeObj = {};

    allIds.forEach(pid => {
      const g = scores[pid][h - 1];
      holeObj[pid] = {
        gross: g,
        net: g,                          // YB: no handicap
        fairwayHit: isPar3 ? null : g <= par,
        gir: g <= par + 1,
        putts: g <= par ? 1 : 2,
      };
    });

    const ybNetA = scores[cA][h - 1];
    const ybNetB = scores[cB][h - 1];
    cumA += ybNetA;
    cumB += ybNetB;

    holeObj.holeWinner = ybNetA < ybNetB ? 'teamA' : ybNetA > ybNetB ? 'teamB' : 'half';
    holeObj.ybNetA = ybNetA;
    holeObj.ybNetB = ybNetB;
    u[`holes/${matchId}/${h}`] = holeObj;
  }

  return cumA <= cumB ? 'teamA' : 'teamB';
}

// ── POST /api/seed ───────────────────────────────────────────────────────────

router.post('/', async (req, res) => {
  try {
    await db.ref('/').set(null); // wipe existing data
    const u = {};

    // Tournament meta
    u['tournament/name']   = 'GrayBull Ryder Cup';
    u['tournament/status'] = 'active';
    u['tournament/adminPin'] = '1234';
    u['tournament/teamA']  = { name: 'Northwestern', color: '#4E2A84' };
    u['tournament/teamB']  = { name: 'Nebraska',     color: '#D00000' };

    // Players
    for (const p of PLAYERS) {
      u[`players/${p.id}`] = { name: p.name, teamId: p.teamId, handicap: p.handicap };
    }

    // Course
    u['course/name'] = 'GrayBull Club';
    for (const h of COURSE_HOLES) {
      u[`course/holes/${h.number}`] = { par: h.par, strokeIndex: h.strokeIndex };
    }

    // Running leaderboard totals — accumulated as we build each round
    let lbA = 0, lbB = 0;

    // ── Round 1 · Four-ball · COMPLETE ──────────────────────────────────────
    u['rounds/round1'] = { format: 'fourball', pointsValue: 1, order: 1, status: 'complete' };

    const r1a1 = buildAlloc(['player1','player2','player5','player6']);
    const r1a2 = buildAlloc(['player3','player4','player7','player8']);

    const r1w1 = buildBallHoles(u, 'match1', ['player1','player2'], ['player5','player6'], r1a1, 101);
    const r1w2 = buildBallHoles(u, 'match2', ['player3','player4'], ['player7','player8'], r1a2, 102);

    u['matches/match1'] = {
      roundId: 'round1', format: 'fourball', status: 'complete',
      teamA: { playerIds: ['player1','player2'] },
      teamB: { playerIds: ['player5','player6'] },
      strokeAllocation: r1a1,
      result: { winner: r1w1, points: 1 },
    };
    u['matches/match2'] = {
      roundId: 'round1', format: 'fourball', status: 'complete',
      teamA: { playerIds: ['player3','player4'] },
      teamB: { playerIds: ['player7','player8'] },
      strokeAllocation: r1a2,
      result: { winner: r1w2, points: 1 },
    };

    const r1 = [r1w1, r1w2].reduce((acc, w) => {
      const p = pts(w, 1);
      return { a: acc.a + p.a, b: acc.b + p.b };
    }, { a: 0, b: 0 });
    u['leaderboard/rounds/round1'] = { teamA_pts: r1.a, teamB_pts: r1.b, status: 'complete' };
    lbA += r1.a; lbB += r1.b;

    // ── Round 2 · Singles · COMPLETE ────────────────────────────────────────
    u['rounds/round2'] = { format: 'singles', pointsValue: 1, order: 2, status: 'complete' };

    const singlesMatchups = [
      ['match3', 'player1', 'player5', 201],  // Zach vs Justin
      ['match4', 'player2', 'player6', 202],  // Matt vs Ryan
      ['match5', 'player3', 'player7', 203],  // Jared vs Brother
      ['match6', 'player4', 'player8', 204],  // Ben vs Dan
    ];

    let r2 = { a: 0, b: 0 };
    for (const [mid, aId, bId, seed] of singlesMatchups) {
      const alloc = buildAlloc([aId, bId]);
      const winner = buildBallHoles(u, mid, [aId], [bId], alloc, seed);
      u[`matches/${mid}`] = {
        roundId: 'round2', format: 'singles', status: 'complete',
        teamA: { playerIds: [aId] },
        teamB: { playerIds: [bId] },
        strokeAllocation: alloc,
        result: { winner, points: 1 },
      };
      const p = pts(winner, 1);
      r2.a += p.a; r2.b += p.b;
    }
    u['leaderboard/rounds/round2'] = { teamA_pts: r2.a, teamB_pts: r2.b, status: 'complete' };
    lbA += r2.a; lbB += r2.b;

    // ── Round 3 · Foursomes · COMPLETE ──────────────────────────────────────
    // Seeded as fourball for display purposes (all players have scores).
    u['rounds/round3'] = { format: 'foursomes', pointsValue: 1, order: 3, status: 'complete' };

    const r3a1 = buildAlloc(['player1','player2','player5','player6']);
    const r3a2 = buildAlloc(['player3','player4','player7','player8']);

    const r3w1 = buildBallHoles(u, 'match7', ['player1','player2'], ['player5','player6'], r3a1, 301);
    const r3w2 = buildBallHoles(u, 'match8', ['player3','player4'], ['player7','player8'], r3a2, 302);

    u['matches/match7'] = {
      roundId: 'round3', format: 'foursomes', status: 'complete',
      teamA: { playerIds: ['player1','player2'] },
      teamB: { playerIds: ['player5','player6'] },
      strokeAllocation: r3a1,
      result: { winner: r3w1, points: 1 },
    };
    u['matches/match8'] = {
      roundId: 'round3', format: 'foursomes', status: 'complete',
      teamA: { playerIds: ['player3','player4'] },
      teamB: { playerIds: ['player7','player8'] },
      strokeAllocation: r3a2,
      result: { winner: r3w2, points: 1 },
    };

    const r3 = [r3w1, r3w2].reduce((acc, w) => {
      const p = pts(w, 1);
      return { a: acc.a + p.a, b: acc.b + p.b };
    }, { a: 0, b: 0 });
    u['leaderboard/rounds/round3'] = { teamA_pts: r3.a, teamB_pts: r3.b, status: 'complete' };
    lbA += r3.a; lbB += r3.b;

    // ── Round 4 · Four-ball · ACTIVE (12 holes played) ──────────────────────
    u['rounds/round4'] = { format: 'fourball', pointsValue: 1, order: 4, status: 'active' };

    const r4a1 = buildAlloc(['player1','player2','player5','player6']);
    const r4a2 = buildAlloc(['player3','player4','player7','player8']);

    buildBallHoles(u, 'match9',  ['player1','player2'], ['player5','player6'], r4a1, 401, 12);
    buildBallHoles(u, 'match10', ['player3','player4'], ['player7','player8'], r4a2, 402, 12);

    u['matches/match9'] = {
      roundId: 'round4', format: 'fourball', status: 'active',
      teamA: { playerIds: ['player1','player2'] },
      teamB: { playerIds: ['player5','player6'] },
      strokeAllocation: r4a1, result: null,
    };
    u['matches/match10'] = {
      roundId: 'round4', format: 'fourball', status: 'active',
      teamA: { playerIds: ['player3','player4'] },
      teamB: { playerIds: ['player7','player8'] },
      strokeAllocation: r4a2, result: null,
    };

    // ── Round 5 · Yellow Ball · ACTIVE (9 holes played) ─────────────────────
    u['rounds/round5'] = { format: 'yellowball', pointsValue: 2, order: 5, status: 'active' };

    const ybCarrierA = ['player1','player2','player3','player4'];
    const ybCarrierB = ['player5','player6','player7','player8'];

    buildYBHoles(u, 'match11',
      ['player1','player2','player3','player4'],
      ['player5','player6','player7','player8'],
      ybCarrierA, ybCarrierB, 501, 9
    );

    u['matches/match11'] = {
      roundId: 'round5', format: 'yellowball', status: 'active',
      teamA: { playerIds: ['player1','player2','player3','player4'] },
      teamB: { playerIds: ['player5','player6','player7','player8'] },
      strokeAllocation: {},
      carrierOrder: { teamA: ybCarrierA, teamB: ybCarrierB },
      result: null,
    };

    // ── Round 6 · Foursomes · SETUP ─────────────────────────────────────────
    u['rounds/round6'] = { format: 'foursomes', pointsValue: 1, order: 6, status: 'setup' };
    // No matches yet — admin sets pairings before starting

    // ── Leaderboard ──────────────────────────────────────────────────────────
    // ptsAvailable = active rounds (R4: 2×1pt, R5: 1×2pts) + setup round with
    // expected 2 foursomes matches (R6: 2×1pt)
    const ptsAvailable = 2 + 2 + 2;

    u['leaderboard/teamA_pts']   = lbA;
    u['leaderboard/teamB_pts']   = lbB;
    u['leaderboard/ptsAvailable'] = ptsAvailable;
    u['leaderboard/lastUpdated'] = Date.now();

    await db.ref().update(u);

    res.json({
      ok: true,
      adminPin: '1234',
      leaderboard: { teamA: lbA, teamB: lbB, ptsAvailable },
      roundResults: {
        round1: { teamA: r1.a, teamB: r1.b },
        round2: { teamA: r2.a, teamB: r2.b },
        round3: { teamA: r3.a, teamB: r3.b },
      },
    });
  } catch (err) {
    console.error('Seed error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
