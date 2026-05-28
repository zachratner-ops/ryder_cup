import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ref, onValue, set, update } from 'firebase/database';
import { db } from '../firebase';
import TeamLogo from '../components/TeamLogo';
import styles from './Match.module.css';

function computeMatchStatus(holeResults, teamAIds, teamBIds) {
  let diff = 0;
  let holesPlayed = 0;
  for (let h = 1; h <= 18; h++) {
    const hole = holeResults?.[h];
    if (!hole?.holeWinner) continue;
    holesPlayed++;
    if (hole.holeWinner === 'teamA') diff++;
    else if (hole.holeWinner === 'teamB') diff--;
    // Detect match decided: leading margin exceeds holes remaining
    const margin = Math.abs(diff);
    const remaining = 18 - holesPlayed;
    if (margin > remaining) return `${margin}&${remaining}`;
  }
  if (holesPlayed === 0) return 'All Square';
  if (diff === 0) return `All Square thru ${holesPlayed}`;
  const margin = Math.abs(diff);
  return `${margin}UP thru ${holesPlayed}`;
}

export default function Match({ playerId, isAdmin }) {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [round, setRound] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [holeData, setHoleData] = useState({});
  const [players, setPlayers] = useState({});
  const [courseHoles, setCourseHoles] = useState({});
  const [currentHole, setCurrentHole] = useState(1);
  // Admin: which player's score is currently being entered
  const [entryForId, setEntryForId] = useState(null);
  // Yellow ball scorecard tab: 'teamA' | 'teamB' | 'score'
  const [ybTab, setYbTab] = useState(null); // null = derive from player's team
  const [entry, setEntry] = useState({ gross: '', fairwayHit: null, gir: false, putts: '' });
  const [justSaved, setJustSaved] = useState(false);
  const initialJumped = useRef(false);

  useEffect(() => {
    const u1 = onValue(ref(db, `matches/${matchId}`), (s) => setMatch(s.val()));
    const u2 = onValue(ref(db, `holes/${matchId}`), (s) => setHoleData(s.val() || {}));
    const u3 = onValue(ref(db, 'players'), (s) => setPlayers(s.val() || {}));
    const u4 = onValue(ref(db, 'course/holes'), (s) => setCourseHoles(s.val() || {}));
    const u5 = onValue(ref(db, 'tournament'), (s) => setTournament(s.val()));
    return () => { u1(); u2(); u3(); u4(); u5(); };
  }, [matchId]);

  // Load round data (needed for yellow ball carrier order)
  useEffect(() => {
    if (!match?.roundId) return;
    const u = onValue(ref(db, `rounds/${match.roundId}`), (s) => setRound(s.val()));
    return u;
  }, [match?.roundId]);

  // Auto-advance to first unplayed hole on initial load
  useEffect(() => {
    if (initialJumped.current || Object.keys(holeData).length === 0) return;
    const firstUnplayed = Array.from({ length: 18 }, (_, i) => i + 1)
      .find(h => !holeData[h]?.holeWinner);
    if (firstUnplayed) setCurrentHole(firstUnplayed);
    initialJumped.current = true;
  }, [holeData]);

  // Admin: initialise entryForId to first player (or 'teamA' for foursomes)
  useEffect(() => {
    if (!isAdmin || entryForId || !match) return;
    if (match.format === 'foursomes') {
      setEntryForId('teamA');
    } else {
      const first = match.teamA?.playerIds?.[0] || match.teamB?.playerIds?.[0];
      if (first) setEntryForId(first);
    }
  }, [isAdmin, match, entryForId]);

  // Default gross to par when hole changes (non-admin path)
  useEffect(() => {
    if (isAdmin) return; // admin uses its own pre-fill effect below
    const par = courseHoles[currentHole]?.par;
    if (!par) return;
    setEntry({ gross: par, fairwayHit: null, gir: false, putts: '' });
  }, [currentHole, courseHoles, isAdmin]);

  // Admin: pre-fill from the selected player's existing score when player or hole changes
  useEffect(() => {
    if (!isAdmin || !entryForId) return;
    const existing = holeData[currentHole]?.[entryForId];
    const par = courseHoles[currentHole]?.par;
    if (existing?.gross) {
      setEntry({
        gross: existing.gross,
        fairwayHit: existing.fairwayHit ?? null,
        gir: existing.gir ?? false,
        putts: existing.putts ?? '',
      });
    } else {
      setEntry({ gross: par || '', fairwayHit: null, gir: false, putts: '' });
    }
    // holeData intentionally omitted: we don't want live score updates resetting the form
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdmin, entryForId, currentHole, courseHoles]);

  if (!match) return <div className={styles.loading}>Loading match…</div>;

  const allPlayerIds = [...(match.teamA?.playerIds || []), ...(match.teamB?.playerIds || [])];

  // Derive default YB tab from player's team; spectators/admin default to 'score'
  const activeYbTab = ybTab ?? (
    match.teamA?.playerIds?.includes(playerId) ? 'teamA'
    : match.teamB?.playerIds?.includes(playerId) ? 'teamB'
    : 'score'
  );

  // Format flags (must come first — used in variable derivations below)
  const isYellowBall = match.format === 'yellowball';
  const isFoursomes = match.format === 'foursomes';

  // For foursomes, derive team from playerId directly to avoid circular dependency
  const playerTeam = match.teamA?.playerIds?.includes(playerId) ? 'teamA'
    : match.teamB?.playerIds?.includes(playerId) ? 'teamB'
    : 'teamA';

  // The player/pair whose score we're currently entering:
  // • normal mode  → the logged-in player (or playerTeam for foursomes)
  // • admin mode   → whichever player/pair admin has selected
  // For foursomes, effectivePlayerId is 'teamA' or 'teamB' (pair key, not a player ID)
  const effectivePlayerId = isFoursomes
    ? (isAdmin ? (entryForId || 'teamA') : playerTeam)
    : (isAdmin ? (entryForId || null) : playerId);

  // myTeam: for foursomes effectivePlayerId is already 'teamA'/'teamB';
  // for other formats derive from which team holds the effectivePlayerId
  const myTeam = isFoursomes
    ? effectivePlayerId
    : (effectivePlayerId && match.teamA?.playerIds?.includes(effectivePlayerId) ? 'teamA'
      : effectivePlayerId && match.teamB?.playerIds?.includes(effectivePlayerId) ? 'teamB'
      : 'teamA');

  // Per-hole running match status for the non-YB scorecard column
  const scorecardStatus = (() => {
    if (isYellowBall) return {};
    const result = {};
    let diff = 0, decided = false, decidedText = '', decidedTeam = null;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (!hd?.holeWinner) break;
      if (decided) { result[h] = { text: decidedText, team: decidedTeam }; continue; }
      if (hd.holeWinner === 'teamA') diff++;
      else if (hd.holeWinner === 'teamB') diff--;
      const remaining = 18 - h;
      const margin = Math.abs(diff);
      const team = diff > 0 ? 'teamA' : diff < 0 ? 'teamB' : null;
      if (diff === 0) {
        result[h] = { text: 'AS', team: null };
      } else if (margin > remaining) {
        decidedText = `${margin}&${remaining}`;
        decidedTeam = team;
        decided = true;
        result[h] = { text: decidedText, team };
      } else {
        result[h] = { text: `${margin} up`, team };
      }
    }
    return result;
  })();
  const carrierOrder = match.carrierOrder || round?.carrierOrder;
  function getCarrier(holeNum, team) {
    const order = carrierOrder?.[team];
    if (!order?.length) return null;
    return order[(holeNum - 1) % order.length];
  }
  const ybCarrierA = isYellowBall ? getCarrier(currentHole, 'teamA') : null;
  const ybCarrierB = isYellowBall ? getCarrier(currentHole, 'teamB') : null;
  const myYBCarrier = isYellowBall && effectivePlayerId
    ? getCarrier(currentHole, myTeam) === effectivePlayerId
    : false;

  const myAllocation = match.strokeAllocation?.[effectivePlayerId]?.holes || [];
  const hole = courseHoles[currentHole] || {};
  const isPar3 = hole.par === 3;
  const receiveStroke = myAllocation.includes(currentHole);
  const gross = parseInt(entry.gross) || 0;
  const net = isYellowBall
    ? (gross > 0 ? gross : null)
    : gross > 0 ? gross - (receiveStroke ? 1 : 0) : null;

  const netVsPar = net != null && hole.par ? net - hole.par : null;
  const stepperAnnotation = netVsPar == null ? ''
    : netVsPar <= -2 ? styles.scoreEagle
    : netVsPar === -1 ? styles.scoreBirdie
    : netVsPar === 1 ? styles.scoreBogey
    : netVsPar >= 2 ? styles.scoreDouble
    : '';

  // Admin can always enter scores; regular players only when in the match
  const isMyMatch = isAdmin ? !!effectivePlayerId : allPlayerIds.includes(playerId);
  const roundComplete = match.status === 'complete';

  const myHoleScore = holeData[currentHole]?.[effectivePlayerId];
  const iSubmitted = !!myHoleScore?.gross;
  const holeComplete = !!holeData[currentHole]?.holeWinner;
  const waitingOn = (() => {
    if (!iSubmitted || holeComplete) return [];
    if (isFoursomes) {
      const opponentPair = myTeam === 'teamA' ? 'teamB' : 'teamA';
      return holeData[currentHole]?.[opponentPair]?.gross ? [] : ['__pair__'];
    }
    if (isYellowBall) {
      return [ybCarrierA, ybCarrierB].filter(id => id && id !== effectivePlayerId && !holeData[currentHole]?.[id]?.gross);
    }
    return allPlayerIds.filter(id => id !== effectivePlayerId && !holeData[currentHole]?.[id]?.gross);
  })();

  // Compute match result info when match is decided or complete
  const resultInfo = (() => {
    if (isYellowBall) {
      let cumA = 0, cumB = 0, holesPlayed = 0;
      for (let h = 1; h <= 18; h++) {
        if (holeData[h]?.ybNetA == null) break;
        cumA += holeData[h].ybNetA; cumB += holeData[h].ybNetB; holesPlayed++;
      }
      if (holesPlayed < 18 && match.status !== 'complete') return null;
      if (holesPlayed === 0) return null;
      const diff = cumA - cumB;
      const winner = diff < 0 ? 'teamA' : diff > 0 ? 'teamB' : null;
      return { winner, text: diff === 0 ? 'Tied — Halved' : `by ${Math.abs(diff)} stroke${Math.abs(diff) !== 1 ? 's' : ''}` };
    }
    let diff = 0, holesPlayed = 0, decided = null;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (!hd?.holeWinner) break;
      holesPlayed++;
      if (hd.holeWinner === 'teamA') diff++;
      else if (hd.holeWinner === 'teamB') diff--;
      const margin = Math.abs(diff), remaining = 18 - holesPlayed;
      if (!decided && (margin > remaining || holesPlayed === 18)) {
        decided = { margin, remaining, diff };
      }
    }
    if (!decided) return null;
    const { margin, remaining, diff: fd } = decided;
    const winner = fd > 0 ? 'teamA' : fd < 0 ? 'teamB' : null;
    const text = fd === 0 ? 'All Square — Halved' : (remaining === 0 ? `${margin} UP` : `${margin}&${remaining}`);
    return { winner, text };
  })();

  async function submitHole() {
    if (!gross || !effectivePlayerId) return;
    const holeRef = ref(db, `holes/${matchId}/${currentHole}/${effectivePlayerId}`);
    await set(holeRef, {
      gross,
      net,
      fairwayHit: isPar3 ? null : entry.fairwayHit,
      gir: entry.gir,
      putts: entry.putts !== '' ? parseInt(entry.putts) : null,
    });

    await computeAndWriteHoleWinner(currentHole);

    setJustSaved(true);
    setTimeout(() => {
      setJustSaved(false);
      // Admin stays on the same hole so they can move to the next player
      if (!isAdmin && currentHole < 18) setCurrentHole(h => h + 1);
    }, 900);
  }

  async function computeAndWriteHoleWinner(holeNum) {
    const snap = await new Promise((resolve) =>
      onValue(ref(db, `holes/${matchId}/${holeNum}`), resolve, { onlyOnce: true })
    );
    const scores = snap.val() || {};

    const teamAIds = match.teamA?.playerIds || [];
    const teamBIds = match.teamB?.playerIds || [];
    const holeRef = ref(db, `holes/${matchId}/${holeNum}`);

    if (isFoursomes) {
      const scoreA = scores.teamA;
      const scoreB = scores.teamB;
      if (scoreA?.net == null || scoreB?.net == null) return;
      const winner = scoreA.net < scoreB.net ? 'teamA' : scoreA.net > scoreB.net ? 'teamB' : 'half';
      const status = computeMatchStatus({ ...holeData, [holeNum]: { holeWinner: winner } }, [], []);
      await update(holeRef, { holeWinner: winner, matchStatus: status });
      return;
    }

    if (isYellowBall) {
      const carrierAId = getCarrier(holeNum, 'teamA');
      const carrierBId = getCarrier(holeNum, 'teamB');
      const ybNetA = scores[carrierAId]?.net;
      const ybNetB = scores[carrierBId]?.net;
      if (ybNetA == null || ybNetB == null) return;
      const winner = ybNetA < ybNetB ? 'teamA' : ybNetA > ybNetB ? 'teamB' : 'half';
      await update(holeRef, { holeWinner: winner, ybNetA, ybNetB });
      return;
    }

    const teamANets = teamAIds.map((id) => scores[id]?.net).filter((n) => n != null);
    const teamBNets = teamBIds.map((id) => scores[id]?.net).filter((n) => n != null);
    if (teamANets.length < teamAIds.length || teamBNets.length < teamBIds.length) return;

    const bestA = Math.min(...teamANets);
    const bestB = Math.min(...teamBNets);
    const winner = bestA < bestB ? 'teamA' : bestA > bestB ? 'teamB' : 'half';
    const status = computeMatchStatus(
      { ...holeData, [holeNum]: { holeWinner: winner } },
      teamAIds,
      teamBIds
    );
    await update(holeRef, { holeWinner: winner, matchStatus: status });
  }

  const matchStatus = (() => {
    if (isYellowBall) {
      let cumA = 0, cumB = 0, holesPlayed = 0;
      for (let h = 1; h <= 18; h++) {
        const hd = holeData[h];
        if (hd?.ybNetA == null || hd?.ybNetB == null) break;
        cumA += hd.ybNetA;
        cumB += hd.ybNetB;
        holesPlayed++;
      }
      if (holesPlayed === 0) return '🟡 Yellow Ball';
      const diff = cumA - cumB;
      if (diff === 0) return `🟡 Tied thru ${holesPlayed}`;
      const margin = Math.abs(diff);
      const leadTeam = diff < 0 ? 'teamA' : 'teamB';
      const leadName = tournament?.[leadTeam]?.name ?? leadTeam;
      return `🟡 ${leadName} leads by ${margin} thru ${holesPlayed}`;
    }
    return computeMatchStatus(holeData, match.teamA?.playerIds, match.teamB?.playerIds);
  })();

  // ─── Yellow ball scorecard ─────────────────────────────────────────────────
  // Three tabs: NW team grid | NE team grid | cumulative score view

  function ybScoreShape(grs, par) {
    if (!grs || !par) return '';
    const d = grs - par;
    if (d <= -2) return styles.scoreEagle;
    if (d === -1) return styles.scoreBirdie;
    if (d === 1) return styles.scoreBogey;
    if (d >= 2) return styles.scoreDouble;
    return '';
  }

  // Per-team tab: 4-player grid with carrier highlighted (stroke play — no winner column, no summary row)
  function renderYBTeamTab(team) {
    // Use carrier rotation order for columns so players appear in order of play
    const tabIds = carrierOrder?.[team] || match[team]?.playerIds || [];
    const teamColor = team === 'teamA' ? 'var(--teamA)' : 'var(--teamB)';
    const gridStyle = { gridTemplateColumns: `28px repeat(${tabIds.length}, 1fr)` };

    return (
      <div className={styles.scorecardGrid}>
        {/* Header: player first names */}
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          {tabIds.map(id => (
            <span key={id} style={{ textAlign: 'center', color: teamColor, fontWeight: 700, fontSize: '13px' }}>
              {players[id]?.name?.split(' ')[0] || id}
            </span>
          ))}
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const carrierForHole = getCarrier(h, team);
          const holePar = courseHoles[h]?.par;

          return (
            <div key={`hole-${h}`} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {tabIds.map(id => {
                const s = hd[id];
                const isCarrier = carrierForHole === id;
                const shapeClass = ybScoreShape(s?.gross, holePar);
                return (
                  <span key={id} className={styles.scScore}>
                    <span className={styles.dotSlot} />
                    <span className={`${styles.scorePill} ${isCarrier ? styles.ybCarrier : ''} ${shapeClass}`}>
                      {s?.gross ?? '—'}
                    </span>
                    <span className={styles.dotSlot} />
                  </span>
                );
              })}
            </div>
          );
        })}
      </div>
    );
  }

  // Score tab: Hole | NW | NE | running cumulative diff
  function renderYBScoreTab() {
    // Compute final totals for the persistent totals row
    let cumA = 0, cumB = 0;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (hd?.ybNetA != null) cumA += hd.ybNetA;
      if (hd?.ybNetB != null) cumB += hd.ybNetB;
    }
    const totalDiff = cumA - cumB;
    const teamAName = tournament?.teamA?.name || 'Team A';
    const teamBName = tournament?.teamB?.name || 'Team B';
    const gridStyle = { gridTemplateColumns: '28px 1fr 1fr 36px' };

    return (
      <div className={styles.scorecardGrid}>
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          <span style={{ textAlign: 'center', color: 'var(--teamA)', fontWeight: 700, fontSize: '13px' }}>{teamAName}</span>
          <span style={{ textAlign: 'center', color: 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>{teamBName}</span>
          <span />
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const carrierAId = getCarrier(h, 'teamA');
          const carrierBId = getCarrier(h, 'teamB');
          const scoreA = hd[carrierAId];
          const scoreB = hd[carrierBId];
          const holePar = courseHoles[h]?.par;

          // Running cumulative diff through this hole
          let runA = 0, runB = 0;
          for (let hh = 1; hh <= h; hh++) {
            const hhd = holeData[hh];
            if (hhd?.ybNetA != null) runA += hhd.ybNetA;
            if (hhd?.ybNetB != null) runB += hhd.ybNetB;
          }
          const holePlayed = hd.ybNetA != null && hd.ybNetB != null;
          const runDiff = runA - runB;
          const diffLabel = !holePlayed ? ''
            : runDiff === 0 ? 'E'
            : `${Math.abs(runDiff)} up`;
          const diffColor = !holePlayed ? 'var(--text-muted)'
            : runDiff < 0 ? 'var(--teamA)'
            : runDiff > 0 ? 'var(--teamB)'
            : 'var(--text-muted)';

          return (
            <div key={h} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {[{ carrierId: carrierAId, score: scoreA }, { carrierId: carrierBId, score: scoreB }].map(({ carrierId, score }, idx) => (
                <span key={idx} className={styles.scScore}>
                  <span className={styles.dotSlot} />
                  <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                    <span className={`${styles.scorePill} ${score?.gross ? styles.ybCarrier : ''} ${ybScoreShape(score?.gross, holePar)}`}>
                      {score?.gross ?? '—'}
                    </span>
                    {carrierId && (
                      <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>
                        {players[carrierId]?.name?.split(' ')[0] || ''}
                      </span>
                    )}
                  </span>
                  <span className={styles.dotSlot} />
                </span>
              ))}
              <span style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: diffColor, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                {diffLabel}
              </span>
            </div>
          );
        })}

        {/* Persistent cumulative totals */}
        <div style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
          <span className={styles.scHole} style={{ fontSize: 10, color: 'var(--yellow)' }}>🟡</span>
          {[{ cum: cumA, color: 'var(--teamA)' }, { cum: cumB, color: 'var(--teamB)' }].map(({ cum, color }, idx) => (
            <span key={idx} className={styles.scScore}>
              <span className={styles.dotSlot} />
              <span className={styles.scorePill} style={{ color, fontWeight: 700 }}>{cum > 0 ? cum : '—'}</span>
              <span className={styles.dotSlot} />
            </span>
          ))}
          <span style={{ textAlign: 'center', fontSize: 11, fontWeight: 700, color: totalDiff < 0 ? 'var(--teamA)' : totalDiff > 0 ? 'var(--teamB)' : 'var(--text-muted)' }}>
            {cumA === 0 && cumB === 0 ? '' : totalDiff === 0 ? 'E' : `${Math.abs(totalDiff)} up`}
          </span>
        </div>
      </div>
    );
  }

  function renderFoursomesScorecard() {
    const gridStyle = { gridTemplateColumns: '28px 1fr 1fr 26px 48px' };
    const teamAIds = match.teamA?.playerIds || [];
    const teamBIds = match.teamB?.playerIds || [];
    const pairNameA = teamAIds.map(id => players[id]?.name?.split(' ')[0]).join(' & ');
    const pairNameB = teamBIds.map(id => players[id]?.name?.split(' ')[0]).join(' & ');
    const allocA = match.strokeAllocation?.teamA?.holes || [];
    const allocB = match.strokeAllocation?.teamB?.holes || [];

    function pairScorePill(score, alloc, h) {
      const holePar = courseHoles[h]?.par;
      const scoreDiff = (score?.gross && holePar) ? score.gross - holePar : null;
      const shapeClass = scoreDiff === null ? ''
        : scoreDiff <= -2 ? styles.scoreEagle
        : scoreDiff === -1 ? styles.scoreBirdie
        : scoreDiff === 1 ? styles.scoreBogey
        : scoreDiff >= 2 ? styles.scoreDouble : '';
      return (
        <span className={styles.scScore}>
          <span className={styles.dotSlot} />
          <span className={`${styles.scorePill} ${shapeClass}`}>{score?.gross ?? '—'}</span>
          <span className={styles.dotSlot}>
            {alloc.includes(h) && <span className={styles.strokeMark} />}
          </span>
        </span>
      );
    }

    const toParForPair = (pairKey, alloc) => {
      let sum = 0, played = 0;
      for (let hh = 1; hh <= 18; hh++) {
        const s = holeData[hh]?.[pairKey];
        const par = courseHoles[hh]?.par;
        if (s?.gross && par) { sum += s.gross - par; played++; }
      }
      return played === 0 ? '—' : sum === 0 ? 'E' : sum > 0 ? `+${sum}` : `${sum}`;
    };

    return (
      <div className={styles.scorecardGrid}>
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          <span style={{ textAlign: 'center', color: 'var(--teamA)', fontWeight: 700, fontSize: '13px' }}>{pairNameA}</span>
          <span style={{ textAlign: 'center', color: 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>{pairNameB}</span>
          <span /><span />
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const winner = hd.holeWinner;
          const st = scorecardStatus[h];
          const stColor = st?.team === 'teamA' ? 'var(--teamA)' : st?.team === 'teamB' ? 'var(--teamB)' : 'var(--text-muted)';
          const isLastPlayed = !!hd.holeWinner && !holeData[h + 1]?.holeWinner;

          const holeRow = (
            <div key={`hole-${h}`} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
              <span className={styles.scHole}>{h}</span>
              {pairScorePill(hd.teamA, allocA, h)}
              {pairScorePill(hd.teamB, allocB, h)}
              <span className={styles.scWinner}>
                {winner === 'half' ? <span className={styles.halfMark}>½</span> : winner ? <TeamLogo teamId={winner} size={18} /> : null}
              </span>
              <span className={styles.scStatus} style={st ? { color: stColor } : {}}>{st?.text ?? ''}</span>
            </div>
          );

          if (!isLastPlayed) return holeRow;

          const toParA = toParForPair('teamA', allocA);
          const toParB = toParForPair('teamB', allocB);
          const colorFor = (str) => str.startsWith('-') ? 'var(--green)' : str === 'E' ? 'var(--text-muted)' : '#c0392b';

          return [
            holeRow,
            <div key={`topar-${h}`} style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
              <span className={styles.scHole} style={{ fontSize: 9, color: 'var(--text-muted)' }}>vs par</span>
              {[['teamA', toParA], ['teamB', toParB]].map(([key, str]) => (
                <span key={key} className={styles.scScore}>
                  <span className={styles.dotSlot} />
                  <span className={styles.scorePill} style={{ color: colorFor(str), fontWeight: 700 }}>{str}</span>
                  <span className={styles.dotSlot} />
                </span>
              ))}
              <span /><span />
            </div>,
          ];
        })}
      </div>
    );
  }

  return (
    <div className={styles.page}>
      {/* Header */}
      <div className={styles.header}>
        <button className={styles.back} onClick={() => navigate('/')}>‹ Back</button>
        <div className={styles.matchStatus}>{matchStatus}</div>
      </div>

      {/* Teams */}
      <div className={styles.teams}>
        <div className={`${styles.teamPill} ${styles.teamA}`}>
          {isYellowBall ? (tournament?.teamA?.name || 'Team A') : match.teamA?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
        <div className={styles.vsLabel}>vs</div>
        <div className={`${styles.teamPill} ${styles.teamB}`}>
          {isYellowBall ? (tournament?.teamB?.name || 'Team B') : match.teamB?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
      </div>

      {/* Hole selector */}
      <div className={styles.holeNav}>
        {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
          const played = !!holeData[h]?.holeWinner;
          return (
            <button
              key={h}
              className={`${styles.holeBtn} ${currentHole === h ? styles.holeCurrent : ''} ${played ? styles.holeDone : ''}`}
              onClick={() => setCurrentHole(h)}
            >
              {h}
            </button>
          );
        })}
      </div>

      {/* Current hole info */}
      <div className={styles.holeInfo}>
        <span className={styles.holeLabel}>Hole {currentHole}</span>
        <span className={styles.holePar}>Par {hole.par || '—'}</span>
        <span className={styles.holeSI}>Handicap {hole.strokeIndex || '—'}</span>
        {receiveStroke && !isYellowBall && <span className={styles.strokeDot}>+1 stroke</span>}
      </div>

      {/* Score entry */}
      {isMyMatch && !roundComplete && (
        <div className={styles.entryCard}>
          {/* Admin: player/pair picker; or player label for non-admin */}
          {isAdmin && isFoursomes ? (
            <div className={styles.field}>
              <label style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Entering for
              </label>
              <select
                value={entryForId || 'teamA'}
                onChange={e => setEntryForId(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '16px', fontWeight: 600, color: 'var(--text)' }}
              >
                <option value="teamA">{tournament?.teamA?.name || 'Team A'}: {match.teamA?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}</option>
                <option value="teamB">{tournament?.teamB?.name || 'Team B'}: {match.teamB?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}</option>
              </select>
            </div>
          ) : isAdmin ? (
            <div className={styles.field}>
              <label style={{ fontSize: '14px', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Entering for
              </label>
              <select
                value={entryForId || ''}
                onChange={e => setEntryForId(e.target.value)}
                style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '8px 12px', fontSize: '16px', fontWeight: 600, color: 'var(--text)', maxWidth: '180px' }}
              >
                {allPlayerIds.map(id => {
                  const isTeamA = match.teamA?.playerIds?.includes(id);
                  return (
                    <option key={id} value={id}>
                      {players[id]?.name || id} ({isTeamA ? tournament?.teamA?.name || 'A' : tournament?.teamB?.name || 'B'})
                    </option>
                  );
                })}
              </select>
            </div>
          ) : isFoursomes ? (
            <div className={styles.entryLabel}>
              Pair score — {match[myTeam]?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}
            </div>
          ) : (
            <div className={styles.entryLabel}>Your score — {players[playerId]?.name}</div>
          )}

          {isYellowBall && (
            <div className={myYBCarrier ? styles.ybBannerCarrying : styles.ybBannerWatching}>
              {myYBCarrier
                ? '🟡 You have the yellow ball this hole'
                : `🟡 Yellow ball: ${players[ybCarrierA]?.name?.split(' ')[0] ?? '?'} & ${players[ybCarrierB]?.name?.split(' ')[0] ?? '?'}`}
            </div>
          )}

          {/* Score widget: top = gross + annotation, bottom = net section */}
          <div className={styles.grossRow}>
            <div />
            <div className={styles.scoreWidget}>
              <div className={styles.stepper}>
                <button onClick={() => setEntry((e) => ({ ...e, gross: Math.max(1, (parseInt(e.gross) || 0) - 1) }))}>−</button>
                <span className={`${styles.grossNum} ${stepperAnnotation}`}>{entry.gross || '—'}</span>
                <button onClick={() => setEntry((e) => ({ ...e, gross: (parseInt(e.gross) || 0) + 1 }))}>+</button>
              </div>
              {net !== null && !isYellowBall && (
                <div className={styles.netSection}>Net {net}{receiveStroke ? ' ●' : ''}</div>
              )}
            </div>
            <div />
          </div>

          {/* FW / GIR + putts all on one row */}
          <div className={styles.statsRow}>
            {!isPar3 && (
              <button
                className={`${styles.statPill} ${entry.fairwayHit === true ? styles.statPillOn : ''}`}
                onClick={() => setEntry((e) => ({ ...e, fairwayHit: e.fairwayHit === true ? false : true }))}
              >
                FW
              </button>
            )}
            <button
              className={`${styles.statPill} ${entry.gir ? styles.statPillOn : ''}`}
              onClick={() => setEntry((e) => ({ ...e, gir: !e.gir }))}
            >
              GIR
            </button>
            <div className={styles.statDivider} />
            <span className={styles.puttsLabel}>Putts</span>
            {[1, 2, 3, 4].map((n) => (
              <button
                key={n}
                className={`${styles.puttsPill} ${entry.putts === n ? styles.puttsPillOn : ''}`}
                onClick={() => setEntry((e) => ({ ...e, putts: e.putts === n ? '' : n }))}
              >
                {n}
              </button>
            ))}
          </div>

          {justSaved ? (
            <div className={styles.savedBanner}>✓ Saved!</div>
          ) : (
            <button
              className={styles.submitBtn}
              onClick={submitHole}
              disabled={!gross || (isAdmin && !effectivePlayerId)}
            >
              {isFoursomes
                ? `Save Pair Score — Hole ${currentHole}`
                : `Save${isAdmin ? ` ${players[effectivePlayerId]?.name?.split(' ')[0] ?? ''}'s` : ''} Hole ${currentHole}`}
            </button>
          )}

          {waitingOn.length > 0 && (
            <div className={styles.waitingMsg}>
              Waiting on {waitingOn.map(id => {
                if (id === '__pair__') {
                  const opp = myTeam === 'teamA' ? 'teamB' : 'teamA';
                  return match[opp]?.playerIds?.map(pid => players[pid]?.name?.split(' ')[0]).join(' & ');
                }
                return players[id]?.name?.split(' ')[0];
              }).join(', ')}…
            </div>
          )}
        </div>
      )}

      {/* Match result banner — shown when match is decided or round complete */}
      {resultInfo && (
        <div className={styles.resultBanner}>
          {resultInfo.winner ? (
            <>
              <span style={{ color: `var(--${resultInfo.winner})` }}>
                {isFoursomes || isYellowBall
                  ? tournament?.[resultInfo.winner]?.name
                  : match[resultInfo.winner]?.playerIds?.map(id => players[id]?.name?.split(' ')[0]).join(' & ')}
              </span>
              {' win — '}{resultInfo.text}
            </>
          ) : resultInfo.text}
        </div>
      )}

      {/* Scorecard */}
      <div className={styles.scorecard}>
        <div className={styles.sectionLabel}>Scorecard</div>

        {isFoursomes ? renderFoursomesScorecard() : isYellowBall ? (
          <>
            <div className={styles.ybTabs}>
              <button
                className={`${styles.ybTabBtn} ${activeYbTab === 'teamA' ? styles.ybTabActive : ''}`}
                style={activeYbTab === 'teamA' ? { color: 'var(--teamA)', borderColor: 'var(--teamA)' } : {}}
                onClick={() => setYbTab('teamA')}
              >
                {tournament?.teamA?.name || 'Team A'}
              </button>
              <button
                className={`${styles.ybTabBtn} ${activeYbTab === 'teamB' ? styles.ybTabActive : ''}`}
                style={activeYbTab === 'teamB' ? { color: 'var(--teamB)', borderColor: 'var(--teamB)' } : {}}
                onClick={() => setYbTab('teamB')}
              >
                {tournament?.teamB?.name || 'Team B'}
              </button>
              <button
                className={`${styles.ybTabBtn} ${activeYbTab === 'score' ? styles.ybTabActive : ''}`}
                style={activeYbTab === 'score' ? { color: 'var(--yellow)', borderColor: 'var(--yellow)' } : {}}
                onClick={() => setYbTab('score')}
              >
                🟡 Score
              </button>
            </div>
            {activeYbTab === 'teamA' && renderYBTeamTab('teamA')}
            {activeYbTab === 'teamB' && renderYBTeamTab('teamB')}
            {activeYbTab === 'score' && renderYBScoreTab()}
          </>
        ) : (
          <div className={styles.scorecardGrid}>
            <div
              className={`${styles.scRow} ${styles.scHeader}`}
              style={{ gridTemplateColumns: `28px repeat(${allPlayerIds.length}, 1fr) 26px 48px` }}
            >
              <span />
              {allPlayerIds.map((id) => {
                const isTeamA = match.teamA?.playerIds?.includes(id);
                return (
                  <span key={id} style={{ textAlign: 'center', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '2px' }}>
                    <span style={{ color: isTeamA ? 'var(--teamA)' : 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>
                      {players[id]?.name?.split(' ')[0] || id}
                    </span>
                    <span style={{ fontSize: '10px', color: 'var(--text-muted)', fontWeight: 400 }}>
                      hcp {players[id]?.handicap ?? '—'}
                    </span>
                  </span>
                );
              })}
              <span /><span />
            </div>

            {Array.from({ length: 18 }, (_, i) => i + 1).map((h) => {
              const hd = holeData[h] || {};
              const winner = hd.holeWinner;
              const holePar = courseHoles[h]?.par;

              const carriers = new Set();
              ['teamA', 'teamB'].forEach((team) => {
                const ids = match[team]?.playerIds || [];
                const nets = ids.map((id) => ({ id, net: hd[id]?.net })).filter((x) => x.net != null);
                if (!nets.length) return;
                const best = Math.min(...nets.map((x) => x.net));
                nets.filter((x) => x.net === best).forEach((x) => carriers.add(x.id));
              });

              const gridStyle = { gridTemplateColumns: `28px repeat(${allPlayerIds.length}, 1fr) 26px 48px` };
              const isLastPlayed = !!hd.holeWinner && !holeData[h + 1]?.holeWinner;

              // Running match status for the rightmost column
              const st = scorecardStatus[h];
              const stColor = st?.team === 'teamA' ? 'var(--teamA)'
                : st?.team === 'teamB' ? 'var(--teamB)'
                : 'var(--text-muted)';

              const holeRow = (
                <div key={`hole-${h}`} style={gridStyle} className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}>
                  <span className={styles.scHole}>{h}</span>
                  {allPlayerIds.map((id) => {
                    const s = hd[id];
                    const alloc = match.strokeAllocation?.[id]?.holes || [];
                    const isCarrier = carriers.has(id);
                    const isTeamA = match.teamA?.playerIds?.includes(id);
                    const carrierClass = isCarrier ? (isTeamA ? styles.carrierA : styles.carrierB) : '';
                    const scoreDiff = (s?.gross && holePar) ? s.gross - holePar : null;
                    const shapeClass = scoreDiff === null ? ''
                      : scoreDiff <= -2 ? styles.scoreEagle
                      : scoreDiff === -1 ? styles.scoreBirdie
                      : scoreDiff === 1 ? styles.scoreBogey
                      : scoreDiff >= 2 ? styles.scoreDouble
                      : '';
                    return (
                      <span key={id} className={styles.scScore}>
                        <span className={styles.dotSlot} />
                        <span className={`${styles.scorePill} ${carrierClass} ${shapeClass}`}>
                          {s ? s.gross : '—'}
                        </span>
                        <span className={styles.dotSlot}>
                          {alloc.includes(h) && <span className={styles.strokeMark} />}
                        </span>
                      </span>
                    );
                  })}
                  {/* Hole winner icon */}
                  <span className={styles.scWinner}>
                    {winner === 'half' ? <span className={styles.halfMark}>½</span> : winner ? <TeamLogo teamId={winner} size={18} /> : null}
                  </span>
                  {/* Running match score */}
                  <span className={styles.scStatus} style={st ? { color: stColor } : {}}>
                    {st?.text ?? ''}
                  </span>
                </div>
              );

              if (!isLastPlayed) return holeRow;

              const toParCells = allPlayerIds.map(id => {
                let sum = 0, played = 0;
                for (let hh = 1; hh <= 18; hh++) {
                  const s = holeData[hh]?.[id];
                  const par = courseHoles[hh]?.par;
                  if (s?.gross && par) { sum += s.gross - par; played++; }
                }
                const str = played === 0 ? '—' : sum === 0 ? 'E' : sum > 0 ? `+${sum}` : `${sum}`;
                const color = sum < 0 ? 'var(--green)' : sum > 0 ? '#c0392b' : 'var(--text-muted)';
                return { id, str, color };
              });

              return [
                holeRow,
                <div key={`topar-${h}`} style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
                  <span className={styles.scHole} style={{ fontSize: 9, color: 'var(--text-muted)' }}>vs par</span>
                  {toParCells.map(({ id, str, color }) => (
                    <span key={id} className={styles.scScore}>
                      <span className={styles.dotSlot} />
                      <span className={`${styles.scorePill}`} style={{ color, fontWeight: 700 }}>{str}</span>
                      <span className={styles.dotSlot} />
                    </span>
                  ))}
                  <span /><span />
                </div>,
              ];
            })}
          </div>
        )}
      </div>

      <div className={styles.bottomPad} />
    </div>
  );
}
