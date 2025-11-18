const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

app.use(helmet());
app.use(cors());
app.use(express.json());

app.get('/health', (req, res) => {
  res.json({ status: 'healthy', timestamp: new Date().toISOString() });
});

app.get('/', (req, res) => {
  res.json({ service: 'mortgage-optimizer-api', status: 'ok' });
});

app.use((err, req, res, next) => {
  res.status(500).json({ error: 'internal_error' });
});

app.listen(PORT, () => {
  console.log(`API running on port ${PORT}`);
});

module.exports = app;
