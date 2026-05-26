# Ryder Cup Weekend App — Claude Code Briefing

## Project Overview
A mobile-first web app for a friends Ryder Cup-style golf weekend. 8 players, 2 fixed teams of 4, 4-5 rounds over a weekend. Everyone uses the app on their phone to enter scores hole-by-hole. A live leaderboard updates in real time for all players.

---

## Stack

| Layer | Technology |
|---|---|
| Frontend | React (mobile-first, hosted on Railway) |
| Backend | Node.js / Express (Railway) |
| Database | Firebase Realtime Database |
| Domain | Custom domain pointing to Railway |

**Key principle:** Firebase Realtime Database drives all live updates. Clients listen directly to Firebase for leaderboard and match state. Express handles setup logic, handicap calculation, and stroke allocation only — it is not in the hot path for scoring.

---

## Players & Teams

- 8 players total, split into 2 fixed teams of 4
- Teams are fixed for the entire weekend
- Everyone plays every round
- Players identify themselves by picking their name from a list on first open (no password, no auth)
- Selected player identity is persisted in localStorage so they don't re-select mid-round
- Spectators can open the app without selecting a name — read-only leaderboard view
- Admin access is PIN-protected (separate admin PIN set at tournament creation)

---

## Round Formats

Five possible formats. Each round uses one format. Admin sets which format each round uses during setup, and can also set points value per round.

### 1. Four-ball (Best Ball) — BUILD THIS FIRST
- 2v2 match play
- Each player plays their own ball
- Best net score from each pairing counts per hole
- Hole won by the pairing with the lower net best ball
- Running match status tracked hole by hole (e.g. "2UP thru 11")

### 2. Foursomes (Alternate Shot)
- 2v2 match play
- One ball per pairing, players alternate shots
- One gross score entered per pairing per hole
- Handicap: combined pairing handicap / 2, strokes allocated by stroke index

### 3. Singles
- 1v1 match play
- Each player plays their own ball
- Net scores compared hole by hole
- Standard handicap stroke allocation applies

### 4. Yellow Ball
- All 8 players, 4v4
- One player per team "carries" the yellow ball each hole — their net score counts for the team
- Carrier rotates every hole in a fixed order set by admin at round start
- Team with lower cumulative net yellow ball score wins the round
- Points awarded at end of round (not hole by hole)

### 5. 2v2 (format TBD)
- Placeholder — format to be confirmed before building

---

## Handicaps & Stroke Allocation

- All scoring is **net** (handicap applied)
- Players have a course handicap stored on their profile
- Course has a stroke index for each of 18 holes (1 = hardest, 18 = easiest)
- For match play: lower handicap plays off scratch, higher gets the difference in shots allocated by stroke index order
  - Example: Player A = 12hcp, Player B = 6hcp → Player A gets 6 shots on holes with SI 1–6
- For four-ball: each player's individual handicap used, strokes allocated per player independently
- Stroke allocation is **computed once by Express when a match is created** and written to Firebase
- Scoring UI reads stroke allocation from Firebase to display shot indicators — it does not compute them

---

## Scoring Input (per hole, per player)

Players enter the following each hole:
1. **Gross score** (number of strokes)
2. **Fairway hit?** (yes/no toggle — hidden on par 3s)
3. **GIR?** (green in regulation — yes/no toggle)
4. **Putts** (number)

The app computes net score from gross score + stroke allocation automatically. Players never enter net scores directly.

---

## Points System

- Admin sets points value per round during setup (custom per round)
- Standard match play: 1 point per match, 0.5 for a half/tie
- Points accumulate across rounds to a team total
- Leaderboard shows cumulative team points + points remaining available

---

## Firebase Data Model

```
tournament/
  name: string
  status: "setup" | "active" | "complete"
  adminPin: string
  teamA: { name, color }
  teamB: { name, color }

players/
  {playerId}/
    name: string
    teamId: "teamA" | "teamB"
    handicap: number

course/
  name: string
  holes/
    {1-18}/
      par: number
      strokeIndex: number

rounds/
  {roundId}/
    format: "fourball" | "foursomes" | "singles" | "yellowball"
    status: "setup" | "active" | "complete"
    pointsValue: number
    order: number  // round number 1-5

matches/
  {matchId}/
    roundId: string
    format: string
    teamA: { playerIds: [] }
    teamB: { playerIds: [] }
    strokeAllocation: {
      // per player, which holes they receive a stroke on
      {playerId}: { holes: [1, 3, 5, ...] }
    }
    status: "active" | "complete"
    result: { winner: "teamA"|"teamB"|"half", points: number }

holes/
  {matchId}/
    {holeNumber}/
      {playerId}/
        gross: number
        net: number  // computed by app on entry
        fairwayHit: boolean | null  // null on par 3s
        gir: boolean
        putts: number
      holeWinner: "teamA" | "teamB" | "half" | null
      matchStatus: string  // e.g. "2UP" — running match status after this hole

leaderboard/
  teamA_pts: number
  teamB_pts: number
  ptsAvailable: number
  lastUpdated: timestamp
  rounds/
    {roundId}/
      teamA_pts: number
      teamB_pts: number
      status: string

activeSessions/
  {playerId}: { lastSeen: timestamp, deviceId: string }
```

---

## Three App Pages

### 1. Landing Page (main leaderboard)
- Team A vs Team B scoreboard — cumulative points, points available
- Round-by-round breakdown (completed rounds locked, current round live)
- Active matches widget — all live matches with current status (e.g. "Smith/Jones 2UP thru 11")
- Tap any match → navigates to that match's live hole view
- Auto-updates via Firebase listener (no polling)

### 2. Live Match Page
- Your match header: you + partner vs opponents, current match status
- Hole-by-hole scorecard
- Current hole entry form:
  - Gross score input (number stepper)
  - Fairway hit toggle (hidden on par 3s)
  - GIR toggle
  - Putts input
- Net score shown instantly after gross entry
- Stroke indicator displayed on holes where player receives a shot
- Completed holes locked after admin closes round
- Other players in match visible (their scores show once entered)

### 3. Stats Page (live, updates during weekend)
- **Team stats** side by side: GIR%, fairways hit%, avg putts/hole, avg score vs par
- **Individual player cards**: each player's weekend averages across all rounds played
- **Head to head**: select any two players, compare their stats directly
- All computed from raw hole data in Firebase — no separate stats storage needed

---

## Admin Flow

### Before the weekend (one-time setup)
1. Enter tournament name, team names, team colors, admin PIN
2. Add 8 players, assign to teams, enter handicaps
3. Enter course name + stroke index + par for all 18 holes
4. Set round schedule: number of rounds, format per round, points value per round

### Day of each round
1. Admin opens admin panel (PIN required)
2. Selects the round to configure
3. Sets pairings — assigns players to matches for that round
4. For Yellow Ball: sets carrier rotation order
5. Hits "Start Round" → round goes live, players see their match view

### During the round
- Admin can monitor all matches
- Can correct a score if needed (override)

### End of round
- Admin hits "Close Round" → scoring locked, points finalised
- Leaderboard updates with final round result
- Admin then sets up next round

---

## Express API Endpoints

```
POST /api/tournament/setup         — create tournament, teams, players, course
POST /api/rounds/:roundId/start    — set pairings, compute stroke allocation, set round live
POST /api/rounds/:roundId/close    — lock scoring, finalise points, update leaderboard
POST /api/matches/:matchId/correct — admin score correction
GET  /api/tournament/status        — current tournament state (for app init)
```

Stroke allocation logic lives in Express. All other scoring logic (net score, hole winner, match status, leaderboard points) is computed **client-side** on score entry and written directly to Firebase.

---

## Build Order

1. **Firebase schema** — initialise Realtime DB with the structure above, write security rules
2. **Express setup endpoints** — tournament creation, round start (stroke allocation engine), round close
3. **React app scaffold** — routing, Firebase client setup, player selection screen
4. **Four-ball scoring** — live match page with hole entry, net score calc, match status, Firebase writes
5. **Landing page** — leaderboard listener, active matches widget
6. **Stats page** — aggregations from hole data
7. **Admin panel** — setup flow, round management
8. **Remaining formats** — Foursomes, Singles, Yellow Ball (built on top of four-ball foundation)

---

## Key Constraints & Notes

- **Mobile-first** — design for iPhone screen width, thumb-friendly tap targets
- **No polling** — all live data via Firebase `onValue` listeners
- **Format-agnostic score entry** — players always enter gross scores; net/match logic is computed, never manually entered
- **Fairway hit hides on par 3s** — requires par per hole from course data
- **Stroke indicators on scorecard** — show which holes a player receives a shot clearly in the UI
- **localStorage for player session** — persist selected playerId so tab refresh doesn't lose identity
- **activeSessions node** — show which player names are already claimed on another device
- **Admin PIN** — simple string comparison server-side, no JWT needed for this use case
