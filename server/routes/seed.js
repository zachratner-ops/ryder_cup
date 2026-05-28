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

// ── Seeded PRNG (Mulberry32) ─────────────────────────────────────────────────
// Pass ?seed=N to reproduce any tournament, or omit for a fresh random one.
// Each call to rng() returns a float in [0, 1).

function makePRNG(seed) {
  let s = seed >>> 0;
  return function () {
    s |= 0;
    s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── Realistic gross score distribution ───────────────────────────────────────
// Probabilities: [birdie, par, bogey, double, triple+]
// Tiers: scratch-ish (≤6), mid (7-13), high (14+)
const SCORE_PROBS = {
  low:  [0.14, 0.48, 0.28, 0.08, 0.02],  // hcp ≤ 6
  mid:  [0.05, 0.36, 0.38, 0.16, 0.05],  // hcp 7-13
  high: [0.02, 0.20, 0.38, 0.28, 0.12],  // hcp 14+
};

function gross(par, handicap, rng) {
  const tier = handicap <= 6 ? 'low' : handicap <= 13 ? 'mid' : 'high';
  const probs = SCORE_PROBS[tier];
  const r = rng();
  let cum = 0;
  for (let i = 0; i < probs.length; i++) {
    cum += probs[i];
    if (r < cum) return Math.max(1, par + (i - 1)); // i=0 → birdie, i=1 → par, ...
  }
  return par + 3; // fallback triple
}

// ── Helpers ─────────────────────────────────────────────────────────────────

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

function statusStr(diff, played) {
  if (played === 0) return 'All Square';
  const rem = 18 - played;
  if (diff === 0) return `All Square thru ${played}`;
  const m = Math.abs(diff);
  return m > rem ? `${m}UP (closed)` : `${m}UP thru ${played}`;
}

function pts(winner, value) {
  if (winner === 'teamA') return { a: value, b: 0 };
  if (winner === 'teamB') return { a: 0, b: value };
  return { a: value / 2, b: value / 2 };
}

// ── Match hole builders ──────────────────────────────────────────────────────

function buildBallHoles(u, matchId, teamAIds, teamBIds, alloc, rng, n = 18) {
  const allIds = [...teamAIds, ...teamBIds];

  // Generate all gross scores up front
  const scores = {};
  for (const pid of allIds) {
    scores[pid] = COURSE_HOLES.slice(0, n).map(({ par }) =>
      gross(par, PM[pid].handicap, rng)
    );
  }

  let diff = 0, played = 0;
  for (let h = 1; h <= n; h++) {
    const { par } = COURSE_HOLES[h - 1];
    const isPar3 = par === 3;
    const holeObj = {};

    for (const pid of allIds) {
      const g = scores[pid][h - 1];
      const net = g - (alloc[pid]?.holes?.includes(h) ? 1 : 0);
      holeObj[pid] = {
        gross: g,
        net,
        fairwayHit: isPar3 ? null : g <= par,
        gir: g <= par + 1,
        putts: net <= par ? 1 : 2,
      };
    }

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

function buildYBHoles(u, matchId, teamAIds, teamBIds, carrierA, carrierB, rng, n = 18) {
  const allIds = [...teamAIds, ...teamBIds];

  const scores = {};
  for (const pid of allIds) {
    scores[pid] = COURSE_HOLES.slice(0, n).map(({ par }) =>
      gross(par, PM[pid].handicap, rng)
    );
  }

  let cumA = 0, cumB = 0;
  for (let h = 1; h <= n; h++) {
    const { par } = COURSE_HOLES[h - 1];
    const isPar3 = par === 3;
    const cA = carrierA[(h - 1) % carrierA.length];
    const cB = carrierB[(h - 1) % carrierB.length];
    const holeObj = {};

    for (const pid of allIds) {
      const g = scores[pid][h - 1];
      holeObj[pid] = {
        gross: g,
        net: g,
        fairwayHit: isPar3 ? null : g <= par,
        gir: g <= par + 1,
        putts: g <= par ? 1 : 2,
      };
    }

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
// Query params:
//   seed    - integer seed for reproducible results (default: random)
//   r4holes - holes played in round 4 fourball (default: 12, range 0-18)
//   r5holes - holes played in round 5 yellow ball (default: 9, range 0-18)

router.post('/', async (req, res) => {
  try {
    // Resolve seed: use provided value or generate a random one
    const seed = req.query.seed != null
      ? (parseInt(req.query.seed) >>> 0)
      : (Date.now() & 0xFFFFFFFF);

    const r4holes = Math.min(18, Math.max(0, parseInt(req.query.r4holes ?? '12')));
    const r5holes = Math.min(18, Math.max(0, parseInt(req.query.r5holes ?? '9')));

    const rng = makePRNG(seed);

    await db.ref('/').set(null);
    const u = {};

    // Tournament meta
    u['tournament/name']     = 'GrayBull Ryder Cup';
    u['tournament/status']   = 'active';
    u['tournament/adminPin'] = '1234';
    u['tournament/teamA']    = { name: 'Northwestern', color: '#4E2A84' };
    u['tournament/teamB']    = { name: 'Nebraska',     color: '#D00000' };

    // Players
    for (const p of PLAYERS) {
      u[`players/${p.id}`] = { name: p.name, teamId: p.teamId, handicap: p.handicap };
    }

    // Course
    u['course/name'] = 'GrayBull Club';
    for (const h of COURSE_HOLES) {
      u[`course/holes/${h.number}`] = { par: h.par, strokeIndex: h.strokeIndex };
    }

    let lbA = 0, lbB = 0;

    // ── Round 1 · Four-ball · COMPLETE ──────────────────────────────────────
    u['rounds/round1'] = { format: 'fourball', pointsValue: 1, order: 1, status: 'complete' };

    const r1a1 = buildAlloc(['player1','player2','player5','player6']);
    const r1a2 = buildAlloc(['player3','player4','player7','player8']);
    const r1w1 = buildBallHoles(u, 'match1', ['player1','player2'], ['player5','player6'], r1a1, rng);
    const r1w2 = buildBallHoles(u, 'match2', ['player3','player4'], ['player7','player8'], r1a2, rng);

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
      const p = pts(w, 1); return { a: acc.a + p.a, b: acc.b + p.b };
    }, { a: 0, b: 0 });
    u['leaderboard/rounds/round1'] = { teamA_pts: r1.a, teamB_pts: r1.b, status: 'complete' };
    lbA += r1.a; lbB += r1.b;

    // ── Round 2 · Singles · COMPLETE ────────────────────────────────────────
    u['rounds/round2'] = { format: 'singles', pointsValue: 1, order: 2, status: 'complete' };

    const singlesMatchups = [
      ['match3', 'player1', 'player5'],
      ['match4', 'player2', 'player6'],
      ['match5', 'player3', 'player7'],
      ['match6', 'player4', 'player8'],
    ];

    let r2 = { a: 0, b: 0 };
    for (const [mid, aId, bId] of singlesMatchups) {
      const alloc = buildAlloc([aId, bId]);
      const winner = buildBallHoles(u, mid, [aId], [bId], alloc, rng);
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
    u['rounds/round3'] = { format: 'foursomes', pointsValue: 1, order: 3, status: 'complete' };

    const r3a1 = buildAlloc(['player1','player2','player5','player6']);
    const r3a2 = buildAlloc(['player3','player4','player7','player8']);
    const r3w1 = buildBallHoles(u, 'match7', ['player1','player2'], ['player5','player6'], r3a1, rng);
    const r3w2 = buildBallHoles(u, 'match8', ['player3','player4'], ['player7','player8'], r3a2, rng);

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
      const p = pts(w, 1); return { a: acc.a + p.a, b: acc.b + p.b };
    }, { a: 0, b: 0 });
    u['leaderboard/rounds/round3'] = { teamA_pts: r3.a, teamB_pts: r3.b, status: 'complete' };
    lbA += r3.a; lbB += r3.b;

    // ── Round 4 · Four-ball · ACTIVE ────────────────────────────────────────
    u['rounds/round4'] = { format: 'fourball', pointsValue: 1, order: 4, status: 'active' };

    const r4a1 = buildAlloc(['player1','player2','player5','player6']);
    const r4a2 = buildAlloc(['player3','player4','player7','player8']);
    buildBallHoles(u, 'match9',  ['player1','player2'], ['player5','player6'], r4a1, rng, r4holes);
    buildBallHoles(u, 'match10', ['player3','player4'], ['player7','player8'], r4a2, rng, r4holes);

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

    // ── Round 5 · Yellow Ball · ACTIVE ──────────────────────────────────────
    u['rounds/round5'] = { format: 'yellowball', pointsValue: 2, order: 5, status: 'active' };

    const ybCarrierA = ['player1','player2','player3','player4'];
    const ybCarrierB = ['player5','player6','player7','player8'];
    buildYBHoles(u, 'match11',
      ['player1','player2','player3','player4'],
      ['player5','player6','player7','player8'],
      ybCarrierA, ybCarrierB, rng, r5holes
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

    // ── Leaderboard ──────────────────────────────────────────────────────────
    const ptsAvailable = 2 + 2 + 2;
    u['leaderboard/teamA_pts']    = lbA;
    u['leaderboard/teamB_pts']    = lbB;
    u['leaderboard/ptsAvailable'] = ptsAvailable;
    u['leaderboard/lastUpdated']  = Date.now();

    await db.ref().update(u);

    res.json({
      ok: true,
      seed,                    // echo back so you can reproduce this exact tournament
      params: { r4holes, r5holes },
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
