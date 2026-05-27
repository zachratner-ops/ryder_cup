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
  }
  if (holesPlayed === 0) return 'All Square';
  const remaining = 18 - holesPlayed;
  if (diff === 0) return `All Square thru ${holesPlayed}`;
  const margin = Math.abs(diff);
  if (margin > remaining) return `${margin}UP (closed)`;
  return `${margin}UP thru ${holesPlayed}`;
}

export default function Match({ playerId }) {
  const { matchId } = useParams();
  const navigate = useNavigate();
  const [match, setMatch] = useState(null);
  const [round, setRound] = useState(null);
  const [tournament, setTournament] = useState(null);
  const [holeData, setHoleData] = useState({});
  const [players, setPlayers] = useState({});
  const [courseHoles, setCourseHoles] = useState({});
  const [currentHole, setCurrentHole] = useState(1);
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

  // Load round data once match is known (needed for yellow ball carrier order)
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

  // Default gross to par when hole changes
  useEffect(() => {
    const par = courseHoles[currentHole]?.par;
    if (!par) return;
    setEntry({ gross: par, fairwayHit: null, gir: false, putts: '' });
  }, [currentHole, courseHoles]);

  if (!match) return <div className={styles.loading}>Loading match…</div>;

  // Yellow ball helpers
  const isYellowBall = match.format === 'yellowball';
  const carrierOrder = match.carrierOrder || round?.carrierOrder;
  function getCarrier(holeNum, team) {
    const order = carrierOrder?.[team];
    if (!order?.length) return null;
    return order[(holeNum - 1) % order.length];
  }
  const ybCarrierA = isYellowBall ? getCarrier(currentHole, 'teamA') : null;
  const ybCarrierB = isYellowBall ? getCarrier(currentHole, 'teamB') : null;
  const myTeam = playerId && match.teamA?.playerIds?.includes(playerId) ? 'teamA'
    : playerId && match.teamB?.playerIds?.includes(playerId) ? 'teamB'
    : 'teamA';
  const myYBCarrier = isYellowBall ? getCarrier(currentHole, myTeam) === playerId : false;

  const allPlayerIds = [...(match.teamA?.playerIds || []), ...(match.teamB?.playerIds || [])];
  const myAllocation = match.strokeAllocation?.[playerId]?.holes || [];
  const hole = courseHoles[currentHole] || {};
  const isPar3 = hole.par === 3;
  const receiveStroke = myAllocation.includes(currentHole);
  const gross = parseInt(entry.gross) || 0;
  // Yellow ball has no handicap — net equals gross
  const net = isYellowBall
    ? (gross > 0 ? gross : null)
    : gross > 0 ? gross - (receiveStroke ? 1 : 0) : null;

  const isMyMatch = allPlayerIds.includes(playerId);
  const roundComplete = match.status === 'complete';

  const myHoleScore = holeData[currentHole]?.[playerId];
  const iSubmitted = !!myHoleScore?.gross;
  const holeComplete = !!holeData[currentHole]?.holeWinner;
  // Yellow ball: only wait on the two carriers to resolve the hole winner
  const waitingOn = (() => {
    if (!iSubmitted || holeComplete) return [];
    if (isYellowBall) {
      return [ybCarrierA, ybCarrierB].filter(id => id && id !== playerId && !holeData[currentHole]?.[id]?.gross);
    }
    return allPlayerIds.filter(id => id !== playerId && !holeData[currentHole]?.[id]?.gross);
  })();

  async function submitHole() {
    if (!gross || entry.putts === '') return;
    const holeRef = ref(db, `holes/${matchId}/${currentHole}/${playerId}`);
    await set(holeRef, {
      gross,
      net,
      fairwayHit: isPar3 ? null : entry.fairwayHit,
      gir: entry.gir,
      putts: parseInt(entry.putts),
    });

    await computeAndWriteHoleWinner(currentHole);

    setJustSaved(true);
    setTimeout(() => {
      setJustSaved(false);
      if (currentHole < 18) setCurrentHole(h => h + 1);
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

    if (isYellowBall) {
      // Only the designated carrier's score counts per hole
      const carrierAId = getCarrier(holeNum, 'teamA');
      const carrierBId = getCarrier(holeNum, 'teamB');
      const ybNetA = scores[carrierAId]?.net;
      const ybNetB = scores[carrierBId]?.net;
      if (ybNetA == null || ybNetB == null) return; // wait for both carriers
      const winner = ybNetA < ybNetB ? 'teamA' : ybNetA > ybNetB ? 'teamB' : 'half';
      await update(holeRef, { holeWinner: winner, ybNetA, ybNetB });
      return;
    }

    // Four-ball / foursomes / singles: best net per team
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
      const diff = cumA - cumB; // negative = A winning (lower is better)
      if (diff === 0) return `🟡 Tied thru ${holesPlayed}`;
      const margin = Math.abs(diff);
      const leadTeam = diff < 0 ? 'teamA' : 'teamB';
      const leadName = tournament?.[leadTeam]?.name ?? leadTeam;
      return `🟡 ${leadName} leads by ${margin} thru ${holesPlayed}`;
    }
    return computeMatchStatus(holeData, match.teamA?.playerIds, match.teamB?.playerIds);
  })();

  // ─── Yellow ball scorecard ────────────────────────────────────────────────
  // Single 4-column view: Hole | NW | NE | Winner
  // Each cell shows the carrier's gross score + carrier name beneath + score shapes
  // A persistent totals row is always pinned at the bottom.
  function renderYBScorecard() {
    // Cumulative YB totals across all completed holes
    let cumA = 0, cumB = 0;
    for (let h = 1; h <= 18; h++) {
      const hd = holeData[h];
      if (hd?.ybNetA != null) cumA += hd.ybNetA;
      if (hd?.ybNetB != null) cumB += hd.ybNetB;
    }
    const diff = cumA - cumB; // negative = A winning (lower strokes is better)
    const teamAName = tournament?.teamA?.name || 'Team A';
    const teamBName = tournament?.teamB?.name || 'Team B';
    const gridStyle = { gridTemplateColumns: '28px 1fr 1fr 26px' };

    function scoreShape(gross, par) {
      if (!gross || !par) return '';
      const d = gross - par;
      if (d <= -2) return styles.scoreEagle;
      if (d === -1) return styles.scoreBirdie;
      if (d === 1) return styles.scoreBogey;
      if (d >= 2) return styles.scoreDouble;
      return '';
    }

    return (
      <div className={styles.scorecardGrid}>
        {/* Header: team names */}
        <div className={`${styles.scRow} ${styles.scHeader}`} style={gridStyle}>
          <span />
          <span style={{ textAlign: 'center', color: 'var(--teamA)', fontWeight: 700, fontSize: '13px' }}>
            {teamAName}
          </span>
          <span style={{ textAlign: 'center', color: 'var(--teamB)', fontWeight: 700, fontSize: '13px' }}>
            {teamBName}
          </span>
          <span />
        </div>

        {Array.from({ length: 18 }, (_, i) => i + 1).map(h => {
          const hd = holeData[h] || {};
          const winner = hd.holeWinner;
          const carrierAId = getCarrier(h, 'teamA');
          const carrierBId = getCarrier(h, 'teamB');
          const scoreA = hd[carrierAId];
          const scoreB = hd[carrierBId];
          const holePar = courseHoles[h]?.par;

          return (
            <div
              key={h}
              style={gridStyle}
              className={`${styles.scRow} ${h === currentHole ? styles.scCurrent : ''}`}
            >
              <span className={styles.scHole}>{h}</span>

              {/* Team A carrier score */}
              <span className={styles.scScore}>
                <span className={styles.dotSlot} />
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span className={`${styles.scorePill} ${scoreA?.gross ? styles.ybCarrier : ''} ${scoreShape(scoreA?.gross, holePar)}`}>
                    {scoreA?.gross ?? '—'}
                  </span>
                  {carrierAId && (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>
                      {players[carrierAId]?.name?.split(' ')[0] || ''}
                    </span>
                  )}
                </span>
                <span className={styles.dotSlot} />
              </span>

              {/* Team B carrier score */}
              <span className={styles.scScore}>
                <span className={styles.dotSlot} />
                <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
                  <span className={`${styles.scorePill} ${scoreB?.gross ? styles.ybCarrier : ''} ${scoreShape(scoreB?.gross, holePar)}`}>
                    {scoreB?.gross ?? '—'}
                  </span>
                  {carrierBId && (
                    <span style={{ fontSize: 9, color: 'var(--text-muted)', lineHeight: 1 }}>
                      {players[carrierBId]?.name?.split(' ')[0] || ''}
                    </span>
                  )}
                </span>
                <span className={styles.dotSlot} />
              </span>

              {/* Winner */}
              <span className={styles.scWinner}>
                {winner === 'half'
                  ? <span className={styles.halfMark}>½</span>
                  : winner ? <TeamLogo teamId={winner} size={18} /> : null}
              </span>
            </div>
          );
        })}

        {/* Persistent cumulative totals — always visible */}
        <div style={gridStyle} className={`${styles.scRow} ${styles.scTotalRow}`}>
          <span className={styles.scHole} style={{ fontSize: 10, color: 'var(--yellow)' }}>🟡</span>
          <span className={styles.scScore}>
            <span className={styles.dotSlot} />
            <span className={styles.scorePill} style={{ color: 'var(--teamA)', fontWeight: 700 }}>
              {cumA > 0 ? cumA : '—'}
            </span>
            <span className={styles.dotSlot} />
          </span>
          <span className={styles.scScore}>
            <span className={styles.dotSlot} />
            <span className={styles.scorePill} style={{ color: 'var(--teamB)', fontWeight: 700 }}>
              {cumB > 0 ? cumB : '—'}
            </span>
            <span className={styles.dotSlot} />
          </span>
          <span style={{
            textAlign: 'center', fontSize: 10, fontWeight: 700,
            color: diff < 0 ? 'var(--teamA)' : diff > 0 ? 'var(--teamB)' : 'var(--text-muted)',
          }}>
            {cumA === 0 && cumB === 0 ? ''
              : diff === 0 ? '='
              : diff < 0 ? `−${Math.abs(diff)}`
              : `+${Math.abs(diff)}`}
          </span>
        </div>
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
          {isYellowBall
            ? (tournament?.teamA?.name || 'Team A')
            : match.teamA?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
        </div>
        <div className={styles.vsLabel}>vs</div>
        <div className={`${styles.teamPill} ${styles.teamB}`}>
          {isYellowBall
            ? (tournament?.teamB?.name || 'Team B')
            : match.teamB?.playerIds?.map((id) => players[id]?.name || id).join(' & ')}
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
          <div className={styles.entryLabel}>Your score — {players[playerId]?.name}</div>

          {isYellowBall && (
            <div className={myYBCarrier ? styles.ybBannerCarrying : styles.ybBannerWatching}>
              {myYBCarrier
                ? '🟡 You have the yellow ball this hole'
                : `🟡 Yellow ball: ${players[ybCarrierA]?.name?.split(' ')[0] ?? '?'} & ${players[ybCarrierB]?.name?.split(' ')[0] ?? '?'}`}
            </div>
          )}

          <div className={styles.field}>
            <label>Gross score</label>
            <div className={styles.stepper}>
              <button onClick={() => setEntry((e) => ({ ...e, gross: Math.max(1, (parseInt(e.gross) || 0) - 1) }))}>−</button>
              <span className={styles.stepperVal}>{entry.gross || '—'}</span>
              <button onClick={() => setEntry((e) => ({ ...e, gross: (parseInt(e.gross) || 0) + 1 }))}>+</button>
            </div>
          </div>

          {net !== null && !isYellowBall && (
            <div className={styles.netScore}>Net: {net}{receiveStroke ? ' (stroke)' : ''}</div>
          )}

          {!isPar3 && (
            <div className={styles.field}>
              <label>Fairway hit?</label>
              <div className={styles.toggle}>
                <button
                  className={entry.fairwayHit === true ? styles.toggleOn : ''}
                  onClick={() => setEntry((e) => ({ ...e, fairwayHit: true }))}
                >Yes</button>
                <button
                  className={entry.fairwayHit === false ? styles.toggleOff : ''}
                  onClick={() => setEntry((e) => ({ ...e, fairwayHit: false }))}
                >No</button>
              </div>
            </div>
          )}

          <div className={styles.field}>
            <label>GIR?</label>
            <div className={styles.toggle}>
              <button
                className={entry.gir ? styles.toggleOn : ''}
                onClick={() => setEntry((e) => ({ ...e, gir: true }))}
              >Yes</button>
              <button
                className={!entry.gir ? styles.toggleOff : ''}
                onClick={() => setEntry((e) => ({ ...e, gir: false }))}
              >No</button>
            </div>
          </div>

          <div className={styles.field}>
            <label>Putts</label>
            <div className={styles.stepper}>
              <button onClick={() => setEntry((e) => ({ ...e, putts: Math.max(0, (parseInt(e.putts) || 0) - 1) }))}>−</button>
              <span className={styles.stepperVal}>{entry.putts !== '' ? entry.putts : '—'}</span>
              <button onClick={() => setEntry((e) => ({ ...e, putts: (parseInt(e.putts) || 0) + 1 }))}>+</button>
            </div>
          </div>

          {justSaved ? (
            <div className={styles.savedBanner}>✓ Saved!</div>
          ) : (
            <button
              className={styles.submitBtn}
              onClick={submitHole}
              disabled={!gross || entry.putts === ''}
            >
              Save Hole {currentHole}
            </button>
          )}

          {waitingOn.length > 0 && (
            <div className={styles.waitingMsg}>
              Waiting on {waitingOn.map(id => players[id]?.name?.split(' ')[0]).join(', ')}…
            </div>
          )}
        </div>
      )}

      {/* Scorecard */}
      <div className={styles.scorecard}>
        <div className={styles.sectionLabel}>Scorecard</div>

        {isYellowBall ? renderYBScorecard() : (
          <div className={styles.scorecardGrid}>
            {/* Compact single header row */}
            <div
              className={`${styles.scRow} ${styles.scHeader}`}
              style={{ gridTemplateColumns: `28px repeat(${allPlayerIds.length}, 1fr) 26px` }}
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
              <span />
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

              const gridStyle = { gridTemplateColumns: `28px repeat(${allPlayerIds.length}, 1fr) 26px` };
              const isLastPlayed = !!hd.holeWinner && !holeData[h + 1]?.holeWinner;

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
                  <span className={styles.scWinner}>
                    {winner === 'half' ? <span className={styles.halfMark}>½</span> : winner ? <TeamLogo teamId={winner} size={18} /> : null}
                  </span>
                </div>
              );

              if (!isLastPlayed) return holeRow;

              // To-par summary row pinned after last completed hole
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
                  <span />
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
