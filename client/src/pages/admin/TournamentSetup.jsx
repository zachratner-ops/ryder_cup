import { useState } from 'react';
import styles from './AdminForms.module.css';

const FORMATS = ['fourball', 'foursomes', 'singles', 'yellowball'];

const DEFAULT_PLAYERS = [
  { name: '', teamId: 'teamA', handicap: '' },
  { name: '', teamId: 'teamA', handicap: '' },
  { name: '', teamId: 'teamA', handicap: '' },
  { name: '', teamId: 'teamA', handicap: '' },
  { name: '', teamId: 'teamB', handicap: '' },
  { name: '', teamId: 'teamB', handicap: '' },
  { name: '', teamId: 'teamB', handicap: '' },
  { name: '', teamId: 'teamB', handicap: '' },
];

const DEFAULT_ROUNDS = [
  { format: 'fourball', pointsValue: 1 },
  { format: 'fourball', pointsValue: 1 },
  { format: 'singles', pointsValue: 2 },
];

export default function TournamentSetup() {
  const [step, setStep] = useState(1); // 1=basics, 2=players, 3=course, 4=rounds
  const [saving, setSaving] = useState(false);
  const [done, setDone] = useState(false);

  const [basics, setBasics] = useState({
    name: '',
    adminPin: '',
    teamAName: 'Northwestern',
    teamAColor: '#4E2A84',
    teamBName: 'Nebraska',
    teamBColor: '#D00000',
  });

  const [players, setPlayers] = useState(DEFAULT_PLAYERS);

  const [course, setCourse] = useState({
    name: 'GrayBull Club',
    holes: [
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
    ],
  });

  const [rounds, setRounds] = useState(DEFAULT_ROUNDS);

  function updatePlayer(i, field, value) {
    setPlayers((prev) => {
      const next = [...prev];
      next[i] = { ...next[i], [field]: value };
      return next;
    });
  }

  function updateHole(i, field, value) {
    setCourse((prev) => {
      const next = { ...prev };
      next.holes = [...next.holes];
      next.holes[i] = { ...next.holes[i], [field]: parseInt(value) || 0 };
      return next;
    });
  }

  async function submit() {
    setSaving(true);
    try {
      const body = {
        name: basics.name,
        adminPin: basics.adminPin,
        teamA: { name: basics.teamAName, color: basics.teamAColor },
        teamB: { name: basics.teamBName, color: basics.teamBColor },
        players: players.map((p, i) => ({
          id: `player${i + 1}`,
          name: p.name,
          teamId: p.teamId,
          handicap: parseFloat(p.handicap) || 0,
        })),
        course,
        rounds: rounds.map((r, i) => ({
          id: `round${i + 1}`,
          format: r.format,
          pointsValue: parseFloat(r.pointsValue) || 1,
          order: i + 1,
        })),
      };

      const res = await fetch('/api/tournament/setup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!res.ok) throw new Error(await res.text());
      setDone(true);
    } catch (err) {
      alert(`Setup failed: ${err.message}`);
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return <div className={styles.success}>Tournament created! Head to the leaderboard.</div>;
  }

  return (
    <div className={styles.form}>
      <div className={styles.steps}>
        {['Basics', 'Players', 'Course', 'Rounds'].map((s, i) => (
          <button
            key={s}
            className={`${styles.stepBtn} ${step === i + 1 ? styles.stepActive : ''}`}
            onClick={() => setStep(i + 1)}
          >{s}</button>
        ))}
      </div>

      {step === 1 && (
        <div className={styles.section}>
          <label>Tournament name</label>
          <input value={basics.name} onChange={(e) => setBasics((b) => ({ ...b, name: e.target.value }))} placeholder="Ryder Cup 2026" />
          <label>Admin PIN</label>
          <input type="password" inputMode="numeric" value={basics.adminPin} onChange={(e) => setBasics((b) => ({ ...b, adminPin: e.target.value }))} placeholder="4-digit PIN" />
          <label>Team A name</label>
          <input value={basics.teamAName} onChange={(e) => setBasics((b) => ({ ...b, teamAName: e.target.value }))} />
          <label>Team B name</label>
          <input value={basics.teamBName} onChange={(e) => setBasics((b) => ({ ...b, teamBName: e.target.value }))} />
          <button className={styles.next} onClick={() => setStep(2)}>Next →</button>
        </div>
      )}

      {step === 2 && (
        <div className={styles.section}>
          <div className={styles.teamGroup}>
            <div className={styles.teamHeader} style={{ color: basics.teamAColor }}>{basics.teamAName}</div>
            {players.slice(0, 4).map((p, i) => (
              <div key={i} className={styles.playerRow}>
                <input placeholder={`Player ${i + 1} name`} value={p.name} onChange={(e) => updatePlayer(i, 'name', e.target.value)} className={styles.nameInput} />
                <input type="number" placeholder="Hcp" value={p.handicap} onChange={(e) => updatePlayer(i, 'handicap', e.target.value)} className={styles.hcpInput} />
              </div>
            ))}
          </div>
          <div className={styles.teamGroup}>
            <div className={styles.teamHeader} style={{ color: basics.teamBColor }}>{basics.teamBName}</div>
            {players.slice(4).map((p, i) => (
              <div key={i + 4} className={styles.playerRow}>
                <input placeholder={`Player ${i + 5} name`} value={p.name} onChange={(e) => updatePlayer(i + 4, 'name', e.target.value)} className={styles.nameInput} />
                <input type="number" placeholder="Hcp" value={p.handicap} onChange={(e) => updatePlayer(i + 4, 'handicap', e.target.value)} className={styles.hcpInput} />
              </div>
            ))}
          </div>
          <button className={styles.next} onClick={() => setStep(3)}>Next →</button>
        </div>
      )}

      {step === 3 && (
        <div className={styles.section}>
          <label>Course name</label>
          <input value={course.name} onChange={(e) => setCourse((c) => ({ ...c, name: e.target.value }))} placeholder="Augusta National" />
          <div className={styles.holeGrid}>
            <div className={styles.holeGridHeader}>
              <span>Hole</span><span>Par</span><span>SI</span>
            </div>
            {course.holes.map((h, i) => (
              <div key={i} className={styles.holeRow}>
                <span className={styles.holeNum}>{h.number}</span>
                <select value={h.par} onChange={(e) => updateHole(i, 'par', e.target.value)}>
                  <option>3</option><option>4</option><option>5</option>
                </select>
                <input type="number" min="1" max="18" value={h.strokeIndex} onChange={(e) => updateHole(i, 'strokeIndex', e.target.value)} />
              </div>
            ))}
          </div>
          <button className={styles.next} onClick={() => setStep(4)}>Next →</button>
        </div>
      )}

      {step === 4 && (
        <div className={styles.section}>
          {rounds.map((r, i) => (
            <div key={i} className={styles.roundRow}>
              <span className={styles.roundNum}>Round {i + 1}</span>
              <select value={r.format} onChange={(e) => setRounds((prev) => { const n = [...prev]; n[i] = { ...n[i], format: e.target.value }; return n; })}>
                {FORMATS.map((f) => <option key={f} value={f}>{f}</option>)}
              </select>
              <input type="number" min="0.5" step="0.5" value={r.pointsValue} onChange={(e) => setRounds((prev) => { const n = [...prev]; n[i] = { ...n[i], pointsValue: e.target.value }; return n; })} className={styles.ptsInput} />
              <span className={styles.ptsLabel}>pts</span>
              <button className={styles.removeRound} onClick={() => setRounds((p) => p.filter((_, j) => j !== i))}>✕</button>
            </div>
          ))}
          <button className={styles.addRound} onClick={() => setRounds((p) => [...p, { format: 'fourball', pointsValue: 1 }])}>+ Add round</button>
          <button className={styles.submitBtn} onClick={submit} disabled={saving}>
            {saving ? 'Creating…' : 'Create Tournament'}
          </button>
        </div>
      )}
    </div>
  );
}
