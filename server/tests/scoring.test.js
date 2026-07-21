const { test } = require('node:test');
const assert = require('node:assert/strict');
const { computeMatchResult } = require('../scoring');
const { computeStrokeAllocation } = require('../strokeAllocation');

// ── helpers ──────────────────────────────────────────────────────────────────

// Build a holes node from an array of holeWinner values ('A' | 'B' | 'H')
function matchPlayHoles(winners) {
  const holes = {};
  winners.forEach((w, i) => {
    holes[i + 1] = { holeWinner: w === 'A' ? 'teamA' : w === 'B' ? 'teamB' : 'half' };
  });
  return holes;
}

// Build a scramble holes node from parallel arrays of team gross scores
function scrambleHoles(grossA, grossB) {
  const holes = {};
  grossA.forEach((g, i) => {
    holes[i + 1] = { teamA: { gross: g }, teamB: { gross: grossB[i] } };
  });
  return holes;
}

const COURSE = Array.from({ length: 18 }, (_, i) => ({
  number: i + 1,
  par: 4,
  strokeIndex: i + 1, // SI 1 on hole 1, SI 2 on hole 2, ...
}));

// ── match play (fourball / singles / foursomes) ──────────────────────────────

test('match play: team with more holes wins full points', () => {
  const holes = matchPlayHoles(['A', 'A', 'B', 'A', 'H', 'A']);
  const { result, teamA_pts, teamB_pts } = computeMatchResult(
    { format: 'fourball' }, holes, { pointsValue: 2 }
  );
  assert.equal(result.winner, 'teamA');
  assert.equal(teamA_pts, 2);
  assert.equal(teamB_pts, 0);
});

test('match play: equal holes is a half — points split', () => {
  const holes = matchPlayHoles(['A', 'B', 'H', 'H']);
  const { result, teamA_pts, teamB_pts } = computeMatchResult(
    { format: 'singles' }, holes, { pointsValue: 1 }
  );
  assert.equal(result.winner, 'half');
  assert.equal(teamA_pts, 0.5);
  assert.equal(teamB_pts, 0.5);
});

// ── fourball with segment scoring ────────────────────────────────────────────

test('segmented fourball: each segment awards its own points', () => {
  // Front 9: A wins 5-4 · Back 9: B wins 5-4 → Overall: 9-9 half
  const winners = [
    'A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B', // front: A 5-4
    'B', 'B', 'B', 'B', 'B', 'A', 'A', 'A', 'A', // back:  B 5-4
  ];
  const round = { segmentPoints: { front: 1, back: 1, overall: 2 } };
  const { result, teamA_pts, teamB_pts } = computeMatchResult(
    { format: 'fourball' }, matchPlayHoles(winners), round
  );
  assert.equal(result.segments.front.winner, 'teamA');
  assert.equal(result.segments.back.winner, 'teamB');
  assert.equal(result.segments.overall.winner, 'half');
  assert.equal(teamA_pts, 1 + 1); // front + half of overall
  assert.equal(teamB_pts, 1 + 1); // back + half of overall
  assert.equal(result.winner, 'half');
  assert.equal(result.points, 4);
});

test('segmented fourball: sweep takes all points', () => {
  const winners = Array(18).fill('A');
  const round = { segmentPoints: { front: 1, back: 1, overall: 1 } };
  const { result, teamA_pts, teamB_pts } = computeMatchResult(
    { format: 'fourball' }, matchPlayHoles(winners), round
  );
  assert.equal(result.winner, 'teamA');
  assert.equal(teamA_pts, 3);
  assert.equal(teamB_pts, 0);
});

test('segmented fourball: partial round only counts played holes', () => {
  // Only front 9 played, A up 5-4; back and overall reflect front-only holes
  const winners = ['A', 'A', 'A', 'A', 'A', 'B', 'B', 'B', 'B'];
  const round = { segmentPoints: { front: 1, back: 1, overall: 1 } };
  const { result } = computeMatchResult(
    { format: 'fourball' }, matchPlayHoles(winners), round
  );
  assert.equal(result.segments.front.winner, 'teamA');
  assert.equal(result.segments.back.winner, 'half'); // no back-9 holes played
  assert.equal(result.segments.overall.winner, 'teamA');
});

// ── scramble ─────────────────────────────────────────────────────────────────

test('scramble 18: lower total gross wins', () => {
  const grossA = Array(18).fill(4); // 72
  const grossB = [...Array(17).fill(4), 5]; // 73
  const { result, teamA_pts, teamB_pts } = computeMatchResult(
    { format: 'scramble', holeCount: 18 }, scrambleHoles(grossA, grossB), { pointsValue: 2 }
  );
  assert.equal(result.winner, 'teamA');
  assert.equal(teamA_pts, 2);
  assert.equal(teamB_pts, 0);
});

test('scramble 9: only holes 1-9 count', () => {
  // Equal through 9; B "wins" hole 10 by a mile but it must not count
  const grossA = [...Array(9).fill(4), 10];
  const grossB = [...Array(9).fill(4), 3];
  const { result, teamA_pts, teamB_pts } = computeMatchResult(
    { format: 'scramble', holeCount: 9 }, scrambleHoles(grossA, grossB), { pointsValue: 1 }
  );
  assert.equal(result.winner, 'half');
  assert.equal(teamA_pts, 0.5);
  assert.equal(teamB_pts, 0.5);
});

// ── yellow ball ──────────────────────────────────────────────────────────────

test('yellowball: lower cumulative net wins', () => {
  const holes = {};
  for (let h = 1; h <= 18; h++) holes[h] = { ybNetA: 4, ybNetB: h === 18 ? 6 : 4 };
  const { result, teamA_pts } = computeMatchResult(
    { format: 'yellowball' }, holes, { pointsValue: 2 }
  );
  assert.equal(result.winner, 'teamA');
  assert.equal(teamA_pts, 2);
});

// ── stroke allocation ────────────────────────────────────────────────────────

test('fourball allocation: strokes off the lowest handicap, by stroke index', () => {
  const players = [
    { id: 'p1', handicap: 6 },
    { id: 'p2', handicap: 12 },
  ];
  const alloc = computeStrokeAllocation(players, COURSE, 'fourball');
  assert.deepEqual(alloc.p1.holes, []);
  // 6 strokes on the 6 hardest holes (SI 1-6 → holes 1-6 in this course)
  assert.deepEqual([...alloc.p2.holes].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6]);
});

test('foursomes allocation: pair strokes from combined handicap difference', () => {
  const pairings = [
    { id: 'teamA', combinedHcp: 8 },
    { id: 'teamB', combinedHcp: 11 },
  ];
  const alloc = computeStrokeAllocation(pairings, COURSE, 'foursomes');
  assert.deepEqual(alloc.teamA.holes, []);
  assert.deepEqual([...alloc.teamB.holes].sort((a, b) => a - b), [1, 2, 3]);
});
