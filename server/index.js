require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');

const tournamentRoutes = require('./routes/tournament');
const roundRoutes = require('./routes/rounds');
const matchRoutes = require('./routes/matches');
const seedRoutes = require('./routes/seed');
const betRoutes = require('./routes/bets');
const archiveRoutes = require('./routes/archive');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/tournament', tournamentRoutes);
app.use('/api/rounds', roundRoutes);
app.use('/api/matches', matchRoutes);
app.use('/api/seed', seedRoutes);
app.use('/api/bets', betRoutes);
app.use('/api/archive', archiveRoutes);

app.get('/api/health', (req, res) => res.json({ ok: true }));

// Serve React build in production
const clientDist = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDist));
app.get('*', (req, res) => {
  res.sendFile(path.join(clientDist, 'index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
