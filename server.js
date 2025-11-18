const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const cron = require('node-cron');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Database connection
console.log('DATABASE_URL set:', !!process.env.DATABASE_URL);

if (!process.env.DATABASE_URL) {
  console.error('WARNING: DATABASE_URL is not set!');
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://localhost:5432/mortgage_optimizer',
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

// Initialize database tables
async function initDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deals (
        id SERIAL PRIMARY KEY,
        lender_name VARCHAR(255) NOT NULL,
        product_name VARCHAR(255) NOT NULL,
        interest_rate DECIMAL(5,2) NOT NULL,
        deal_type VARCHAR(50),
        term_years INT,
        max_ltv DECIMAL(5,2),
        arrangement_fee DECIMAL(10,2) DEFAULT 0,
        valuation_fee DECIMAL(10,2) DEFAULT 0,
        legal_fees DECIMAL(10,2) DEFAULT 0,
        cashback DECIMAL(10,2) DEFAULT 0,
        free_valuation BOOLEAN DEFAULT FALSE,
        free_legal_work BOOLEAN DEFAULT FALSE,
        overpayment_allowance DECIMAL(5,2),
        early_repayment_charges TEXT,
        lender_type VARCHAR(100) DEFAULT 'UK Mainstream',
        source VARCHAR(100),
        scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(lender_name, product_name, interest_rate)
      )
    `);

    await pool.query(`
      CREATE TABLE IF NOT EXISTS scrape_logs (
        id SERIAL PRIMARY KEY,
        source VARCHAR(100),
        status VARCHAR(50),
        deals_found INT,
        error_message TEXT,
        scraped_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    console.log('Database tables initialized');
  } catch (error) {
    console.error('Database initialization error:', error);
  }
}

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());

// Import scrapers
const moneySuperMarketScraper = require('./scrapers/moneySuperMarket');
const compareTheMarketScraper = require('./scrapers/compareTheMarket');
const directLendersScraper = require('./scrapers/directLenders');

// Run all scrapers
async function runAllScrapers() {
  console.log('Starting scrape job...');
  const results = [];

  try {
    // MoneySuperMarket
    const msmDeals = await moneySuperMarketScraper.scrape();
    results.push({ source: 'MoneySuperMarket', deals: msmDeals.length });
    await saveDeals(msmDeals, 'MoneySuperMarket');
  } catch (error) {
    console.error('MoneySuperMarket scraper error:', error);
    await logScrape('MoneySuperMarket', 'error', 0, error.message);
  }

  try {
    // Compare The Market
    const ctmDeals = await compareTheMarketScraper.scrape();
    results.push({ source: 'CompareTheMarket', deals: ctmDeals.length });
    await saveDeals(ctmDeals, 'CompareTheMarket');
  } catch (error) {
    console.error('CompareTheMarket scraper error:', error);
    await logScrape('CompareTheMarket', 'error', 0, error.message);
  }

  try {
    // Direct Lenders
    const dlDeals = await directLendersScraper.scrape();
    results.push({ source: 'DirectLenders', deals: dlDeals.length });
    await saveDeals(dlDeals, 'DirectLenders');
  } catch (error) {
    console.error('DirectLenders scraper error:', error);
    await logScrape('DirectLenders', 'error', 0, error.message);
  }

  console.log('Scrape job completed:', results);
  return results;
}

// Save deals to database
async function saveDeals(deals, source) {
  let savedCount = 0;

  for (const deal of deals) {
    try {
      await pool.query(`
        INSERT INTO deals (
          lender_name, product_name, interest_rate, deal_type, term_years,
          max_ltv, arrangement_fee, valuation_fee, legal_fees, cashback,
          free_valuation, free_legal_work, overpayment_allowance,
          early_repayment_charges, lender_type, source
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
        ON CONFLICT (lender_name, product_name, interest_rate)
        DO UPDATE SET
          arrangement_fee = EXCLUDED.arrangement_fee,
          scraped_at = CURRENT_TIMESTAMP
      `, [
        deal.lenderName,
        deal.productName,
        deal.interestRate,
        deal.dealType || 'Fixed',
        deal.termYears || 2,
        deal.maxLTV || 75,
        deal.arrangementFee || 0,
        deal.valuationFee || 0,
        deal.legalFees || 0,
        deal.cashback || 0,
        deal.freeValuation || false,
        deal.freeLegalWork || false,
        deal.overpaymentAllowance || null,
        deal.earlyRepaymentCharges || '',
        deal.lenderType || 'UK Mainstream',
        source
      ]);
      savedCount++;
    } catch (error) {
      console.error('Error saving deal:', error.message);
    }
  }

  await logScrape(source, 'success', savedCount, null);
  return savedCount;
}

// Log scrape results
async function logScrape(source, status, dealsFound, errorMessage) {
  try {
    await pool.query(
      'INSERT INTO scrape_logs (source, status, deals_found, error_message) VALUES ($1, $2, $3, $4)',
      [source, status, dealsFound, errorMessage]
    );
  } catch (error) {
    console.error('Error logging scrape:', error);
  }
}

// Cron job - run scrapers every 6 hours
cron.schedule('0 */6 * * *', async () => {
  console.log('Running scheduled scrape...');
  await runAllScrapers();
});

// ==================== API ROUTES ====================

// Health check
app.get('/health', async (req, res) => {
  let dbStatus = 'unknown';
  try {
    await pool.query('SELECT 1');
    dbStatus = 'connected';
  } catch (error) {
    dbStatus = 'error: ' + error.message;
  }

  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    database: dbStatus,
    databaseUrlSet: !!process.env.DATABASE_URL
  });
});

// Root
app.get('/', (req, res) => {
  res.json({
    service: 'mortgage-optimizer-api',
    status: 'ok',
    endpoints: [
      'GET /api/deals/latest',
      'GET /api/deals/search',
      'POST /api/deals/scrape',
      'GET /api/stats'
    ]
  });
});

// Get latest deals
app.get('/api/deals/latest', async (req, res) => {
  try {
    console.log('Fetching deals from database...');
    console.log('DATABASE_URL exists:', !!process.env.DATABASE_URL);

    const { rows } = await pool.query(`
      SELECT
        id,
        lender_name as "lenderName",
        product_name as "productName",
        interest_rate as "interestRate",
        deal_type as "dealType",
        term_years as "termYears",
        max_ltv as "maxLTV",
        arrangement_fee as "arrangementFee",
        valuation_fee as "valuationFee",
        legal_fees as "legalFees",
        cashback,
        free_valuation as "freeValuation",
        free_legal_work as "freeLegalWork",
        overpayment_allowance as "overpaymentAllowance",
        early_repayment_charges as "earlyRepaymentCharges",
        lender_type as "lenderType",
        source,
        scraped_at as "scrapedAt"
      FROM deals
      ORDER BY interest_rate ASC
      LIMIT 100
    `);

    console.log('Fetched', rows.length, 'deals from database');

    // Calculate monthly payment for each deal (assuming £85,819 balance, 15 years)
    const dealsWithPayments = rows.map(deal => {
      const principal = 85819.31;
      const years = 15;
      const monthlyRate = deal.interestRate / 100 / 12;
      const numPayments = years * 12;
      const monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);

      return {
        ...deal,
        monthlyPayment: Math.round(monthlyPayment * 100) / 100,
        interestRate: parseFloat(deal.interestRate),
        maxLTV: parseFloat(deal.maxLTV),
        arrangementFee: parseFloat(deal.arrangementFee),
        valuationFee: parseFloat(deal.valuationFee),
        legalFees: parseFloat(deal.legalFees),
        cashback: parseFloat(deal.cashback)
      };
    });

    res.json(dealsWithPayments);
  } catch (error) {
    console.error('Error fetching deals:', error.message);
    console.error('Full error:', error);
    res.status(500).json({ error: 'Failed to fetch deals', details: error.message });
  }
});

// Search deals with filters
app.get('/api/deals/search', async (req, res) => {
  try {
    const { maxRate, minLTV, dealType, lenderType } = req.query;

    let query = 'SELECT * FROM deals WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (maxRate) {
      paramCount++;
      query += ` AND interest_rate <= $${paramCount}`;
      params.push(maxRate);
    }

    if (minLTV) {
      paramCount++;
      query += ` AND max_ltv >= $${paramCount}`;
      params.push(minLTV);
    }

    if (dealType) {
      paramCount++;
      query += ` AND deal_type = $${paramCount}`;
      params.push(dealType);
    }

    if (lenderType) {
      paramCount++;
      query += ` AND lender_type = $${paramCount}`;
      params.push(lenderType);
    }

    query += ' ORDER BY interest_rate ASC LIMIT 50';

    const { rows } = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Error searching deals:', error);
    res.status(500).json({ error: 'Failed to search deals' });
  }
});

// Trigger manual scrape
app.post('/api/deals/scrape', async (req, res) => {
  try {
    const results = await runAllScrapers();
    res.json({
      status: 'completed',
      results,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    console.error('Error running scrape:', error);
    res.status(500).json({ error: 'Scrape failed' });
  }
});

// Get stats
app.get('/api/stats', async (req, res) => {
  try {
    const totalDeals = await pool.query('SELECT COUNT(*) FROM deals');
    const avgRate = await pool.query('SELECT AVG(interest_rate) FROM deals');
    const lowestRate = await pool.query('SELECT MIN(interest_rate) FROM deals');
    const lastScrape = await pool.query('SELECT MAX(scraped_at) FROM scrape_logs WHERE status = $1', ['success']);
    const bySource = await pool.query('SELECT source, COUNT(*) as count FROM deals GROUP BY source');

    res.json({
      totalDeals: parseInt(totalDeals.rows[0].count),
      averageRate: parseFloat(avgRate.rows[0].avg).toFixed(2),
      lowestRate: parseFloat(lowestRate.rows[0].min).toFixed(2),
      lastScrape: lastScrape.rows[0].max,
      dealsBySource: bySource.rows
    });
  } catch (error) {
    console.error('Error getting stats:', error.message);
    res.status(500).json({ error: 'Failed to get stats', details: error.message });
  }
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ error: 'internal_error' });
});

// Start server
async function start() {
  await initDatabase();

  app.listen(PORT, () => {
    console.log(`API running on port ${PORT}`);
    console.log('Endpoints available:');
    console.log('  GET  /health');
    console.log('  GET  /api/deals/latest');
    console.log('  GET  /api/deals/search');
    console.log('  POST /api/deals/scrape');
    console.log('  GET  /api/stats');
  });

  // Run initial scrape on startup (delayed to allow server to start)
  setTimeout(async () => {
    console.log('Running initial scrape...');
    await runAllScrapers();
  }, 5000);
}

start();

module.exports = app;
