const express = require('express');
const router = express.Router();
const moneySuperMarket = require('../scrapers/moneySuperMarket');

router.get('/', async (req, res) => {
  try {
    const deals = await moneySuperMarket.scrape();
    res.json({ deals, count: deals.length });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_fetch_deals' });
  }
});

router.post('/refresh', async (req, res) => {
  try {
    const deals = await moneySuperMarket.scrape();
    res.json({ deals, refreshed: true });
  } catch (e) {
    res.status(500).json({ error: 'failed_to_refresh_deals' });
  }
});

module.exports = router;
