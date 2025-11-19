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

const moneySuperMarketScraper = require('./scrapers/moneySuperMarket');

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

  console.log('Scrape job completed:', results);
  return results;
}

function addMetrics(deal, baselineMonthly) {
  const principal = 85819.31;
  const years = 15;
  const monthlyRate = (parseFloat(deal.interestRate) || 0) / 100 / 12;
  const numPayments = years * 12;
  const monthlyPayment = monthlyRate > 0
    ? principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1)
    : 0;
  const arrangementFee = parseFloat(deal.arrangementFee) || 0;
  const valuationFee = parseFloat(deal.valuationFee) || 0;
  const legalFees = parseFloat(deal.legalFees) || 0;
  const cashback = parseFloat(deal.cashback) || 0;
  const netFees = arrangementFee + valuationFee + legalFees - cashback;
  const totalCost2Years = monthlyPayment * 24 + netFees;
  const totalCost5Years = monthlyPayment * 60 + netFees;
  const result = {
    ...deal,
    monthlyPayment: Math.round(monthlyPayment * 100) / 100,
    interestRate: parseFloat(deal.interestRate),
    maxLTV: parseFloat(deal.maxLTV),
    arrangementFee: arrangementFee,
    valuationFee: valuationFee,
    legalFees: legalFees,
    cashback: cashback,
    totalCost2Years: Math.round(totalCost2Years * 100) / 100,
    totalCost5Years: Math.round(totalCost5Years * 100) / 100
  };
  if (baselineMonthly !== undefined) {
    const savings = parseFloat(baselineMonthly) - result.monthlyPayment;
    result.monthlySavings = Math.round(savings * 100) / 100;
    result.breakEvenMonths = savings > 0 && netFees > 0 ? Math.ceil(netFees / savings) : null;
  }
  return result;
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
    const { rows } = await pool.query(
      `SELECT id,
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
      LIMIT 100`
    );

    const baselineMonthly = req.query.baselineMonthly ? parseFloat(req.query.baselineMonthly) : undefined;
    const normalized = rows.map(deal => addMetrics(deal, baselineMonthly));

    if (normalized.length === 0) {
      const enrichedSamples = getSampleDeals().map(d => addMetrics(d, baselineMonthly));
      return res.json(enrichedSamples);
    }

    res.json(normalized);
  } catch (error) {
    console.error('Database error, returning sample deals:', error.message);
    const baselineMonthly = req.query.baselineMonthly ? parseFloat(req.query.baselineMonthly) : undefined;
    const enrichedSamples = getSampleDeals().map(d => addMetrics(d, baselineMonthly));
    return res.json(enrichedSamples);
  }
});

app.get('/api/deals', async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id,
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
      LIMIT 100`
    );

    const baselineMonthly = req.query.baselineMonthly ? parseFloat(req.query.baselineMonthly) : undefined;
    const normalized = rows.map(deal => addMetrics(deal, baselineMonthly));

    if (normalized.length === 0) {
      const enrichedSamples = getSampleDeals().map(d => addMetrics(d, baselineMonthly));
      return res.json(enrichedSamples);
    }

    res.json(normalized);
  } catch (error) {
    const baselineMonthly = req.query.baselineMonthly ? parseFloat(req.query.baselineMonthly) : undefined;
    const enrichedSamples = getSampleDeals().map(d => addMetrics(d, baselineMonthly));
    return res.json(enrichedSamples);
  }
});

app.post('/api/deals/refresh', async (req, res) => {
  try {
    await runAllScrapers();
    res.json({ status: 'ok' });
  } catch (e) {
    res.status(500).json({ error: 'refresh_failed' });
  }
});

// Sample deals fallback
function getSampleDeals() {
  const principal = 85819.31;
  const years = 15;

  const deals = [
    { id: 1, lenderName: 'First Direct', productName: '5 Year Fixed - 60% LTV', interestRate: 4.05, dealType: 'Fixed', termYears: 5, maxLTV: 60, arrangementFee: 490, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 2, lenderName: 'Santander', productName: '5 Year Fixed - 60% LTV', interestRate: 4.09, dealType: 'Fixed', termYears: 5, maxLTV: 60, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 3, lenderName: 'Coventry BS', productName: '2 Year Fixed - 60% LTV', interestRate: 4.12, dealType: 'Fixed', termYears: 2, maxLTV: 60, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 4, lenderName: 'Monzo', productName: '5 Year Fixed - 60% LTV', interestRate: 4.15, dealType: 'Fixed', termYears: 5, maxLTV: 60, arrangementFee: 0, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Challenger Bank' },
    { id: 5, lenderName: 'Halifax', productName: '2 Year Fixed - 60% LTV', interestRate: 4.15, dealType: 'Fixed', termYears: 2, maxLTV: 60, arrangementFee: 1499, valuationFee: 0, legalFees: 0, cashback: 500, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 6, lenderName: 'Nationwide', productName: '2 Year Fixed - 60% LTV', interestRate: 4.19, dealType: 'Fixed', termYears: 2, maxLTV: 60, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: '10.00', earlyRepaymentCharges: '2% Year 1, 1% Year 2', lenderType: 'UK Mainstream' },
    { id: 7, lenderName: 'Lloyds Bank', productName: '2 Year Fixed - 60% LTV', interestRate: 4.22, dealType: 'Fixed', termYears: 2, maxLTV: 60, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 8, lenderName: 'Virgin Money', productName: '5 Year Fixed - 75% LTV', interestRate: 4.25, dealType: 'Fixed', termYears: 5, maxLTV: 75, arrangementFee: 995, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 9, lenderName: 'HSBC', productName: '5 Year Fixed - 75% LTV', interestRate: 4.29, dealType: 'Fixed', termYears: 5, maxLTV: 75, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 250, freeValuation: true, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 10, lenderName: 'Atom Bank', productName: '2 Year Fixed - 75% LTV', interestRate: 4.29, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 0, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Challenger Bank' },
    { id: 11, lenderName: 'Yorkshire BS', productName: '5 Year Fixed - 75% LTV', interestRate: 4.31, dealType: 'Fixed', termYears: 5, maxLTV: 75, arrangementFee: 0, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 12, lenderName: 'Barclays', productName: '2 Year Fixed - 75% LTV', interestRate: 4.35, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 899, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 13, lenderName: 'Leeds BS', productName: '2 Year Fixed - 75% LTV', interestRate: 4.35, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 14, lenderName: 'TSB', productName: '2 Year Fixed - 75% LTV', interestRate: 4.39, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 995, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 15, lenderName: 'Skipton BS', productName: '2 Year Fixed - 75% LTV', interestRate: 4.45, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 995, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 16, lenderName: 'NatWest', productName: '2 Year Fixed - 75% LTV', interestRate: 4.49, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 0, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 17, lenderName: 'Metro Bank', productName: '3 Year Fixed - 75% LTV', interestRate: 4.55, dealType: 'Fixed', termYears: 3, maxLTV: 75, arrangementFee: 499, valuationFee: 0, legalFees: 0, cashback: 1000, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Challenger Bank' },
    { id: 18, lenderName: 'Nationwide', productName: '10 Year Fixed - 60% LTV', interestRate: 4.59, dealType: 'Fixed', termYears: 10, maxLTV: 60, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 19, lenderName: 'Al Rayan Bank', productName: 'Home Purchase Plan - 75% LTV', interestRate: 4.69, dealType: 'Fixed', termYears: 2, maxLTV: 75, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'Islamic Finance' },
    { id: 20, lenderName: 'HSBC', productName: '2 Year Tracker - 60% LTV', interestRate: 4.79, dealType: 'Tracker', termYears: 2, maxLTV: 60, arrangementFee: 999, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: '10.00', earlyRepaymentCharges: '', lenderType: 'UK Mainstream' },
    { id: 21, lenderName: 'Coutts', productName: 'Private Mortgage - 70% LTV', interestRate: 4.85, dealType: 'Fixed', termYears: 5, maxLTV: 70, arrangementFee: 0, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'Private Bank' },
    { id: 22, lenderName: 'HSBC Expat', productName: '2 Year Fixed - 70% LTV', interestRate: 4.99, dealType: 'Fixed', termYears: 2, maxLTV: 70, arrangementFee: 1500, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: false, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'Offshore - Jersey' },
    { id: 23, lenderName: 'Barclays', productName: 'Lifetime Tracker - 75% LTV', interestRate: 5.09, dealType: 'Tracker', termYears: 25, maxLTV: 75, arrangementFee: 0, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: true, freeLegalWork: true, overpaymentAllowance: '100.00', earlyRepaymentCharges: 'None', lenderType: 'UK Mainstream' },
    { id: 24, lenderName: 'Butterfield', productName: '5 Year Fixed - 65% LTV', interestRate: 5.25, dealType: 'Fixed', termYears: 5, maxLTV: 65, arrangementFee: 2000, valuationFee: 0, legalFees: 0, cashback: 0, freeValuation: false, freeLegalWork: false, overpaymentAllowance: null, earlyRepaymentCharges: '', lenderType: 'Offshore - Guernsey' }
  ];

  // Calculate monthly payments
  return deals.map(deal => {
    const monthlyRate = deal.interestRate / 100 / 12;
    const numPayments = years * 12;
    const monthlyPayment = principal * (monthlyRate * Math.pow(1 + monthlyRate, numPayments)) / (Math.pow(1 + monthlyRate, numPayments) - 1);
    return {
      ...deal,
      monthlyPayment: Math.round(monthlyPayment * 100) / 100
    };
  });
}

// Search deals with filters
app.get('/api/deals/search', async (req, res) => {
  try {
    const {
      maxRate,
      minLTV,
      dealType,
      lenderType,
      termYears,
      freeValuation,
      freeLegalWork,
      maxArrangementFee,
      hasCashback,
      limit
    } = req.query;

    let query = 'SELECT id, lender_name as "lenderName", product_name as "productName", interest_rate as "interestRate", deal_type as "dealType", term_years as "termYears", max_ltv as "maxLTV", arrangement_fee as "arrangementFee", valuation_fee as "valuationFee", legal_fees as "legalFees", cashback, free_valuation as "freeValuation", free_legal_work as "freeLegalWork", overpayment_allowance as "overpaymentAllowance", early_repayment_charges as "earlyRepaymentCharges", lender_type as "lenderType", source, scraped_at as "scrapedAt" FROM deals WHERE 1=1';
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

    if (termYears) {
      paramCount++;
      query += ` AND term_years = $${paramCount}`;
      params.push(termYears);
    }

    if (freeValuation === 'true') {
      query += ' AND free_valuation = true';
    }

    if (freeLegalWork === 'true') {
      query += ' AND free_legal_work = true';
    }

    if (maxArrangementFee) {
      paramCount++;
      query += ` AND arrangement_fee <= $${paramCount}`;
      params.push(maxArrangementFee);
    }

    if (hasCashback === 'true') {
      query += ' AND cashback > 0';
    }

    const lim = parseInt(limit || '50', 10);
    query += ` ORDER BY interest_rate ASC LIMIT ${isNaN(lim) ? 50 : lim}`;

    const { rows } = await pool.query(query, params);
    const baselineMonthly = req.query.baselineMonthly ? parseFloat(req.query.baselineMonthly) : undefined;
    const normalized = rows.map(deal => addMetrics(deal, baselineMonthly));

    if (normalized.length === 0) {
      const scraped = await moneySuperMarketScraper.scrape();
      const filtered = scraped.filter(d => {
        if (maxRate && !(d.interestRate <= parseFloat(maxRate))) return false;
        if (minLTV && !(d.maxLTV >= parseFloat(minLTV))) return false;
        if (dealType && d.dealType !== dealType) return false;
        if (lenderType && d.lenderType !== lenderType) return false;
        if (termYears && !(d.termYears === parseInt(termYears))) return false;
        if (freeValuation === 'true' && !d.freeValuation) return false;
        if (freeLegalWork === 'true' && !d.freeLegalWork) return false;
        if (maxArrangementFee && !(d.arrangementFee <= parseFloat(maxArrangementFee))) return false;
        if (hasCashback === 'true' && !(d.cashback && d.cashback > 0)) return false;
        return true;
      }).slice(0, isNaN(lim) ? 50 : lim);
      const enriched = filtered.map(deal => addMetrics(deal, baselineMonthly));
      return res.json(enriched);
    }

    res.json(normalized);
  } catch (error) {
    try {
      const { maxRate, minLTV, dealType, lenderType, termYears, freeValuation, freeLegalWork, maxArrangementFee, hasCashback, limit } = req.query;
      const lim = parseInt(limit || '50', 10);
      const baselineMonthly = req.query.baselineMonthly ? parseFloat(req.query.baselineMonthly) : undefined;
      const scraped = await moneySuperMarketScraper.scrape();
      const filtered = scraped.filter(d => {
        if (maxRate && !(d.interestRate <= parseFloat(maxRate))) return false;
        if (minLTV && !(d.maxLTV >= parseFloat(minLTV))) return false;
        if (dealType && d.dealType !== dealType) return false;
        if (lenderType && d.lenderType !== lenderType) return false;
        if (termYears && !(d.termYears === parseInt(termYears))) return false;
        if (freeValuation === 'true' && !d.freeValuation) return false;
        if (freeLegalWork === 'true' && !d.freeLegalWork) return false;
        if (maxArrangementFee && !(d.arrangementFee <= parseFloat(maxArrangementFee))) return false;
        if (hasCashback === 'true' && !(d.cashback && d.cashback > 0)) return false;
        return true;
      }).slice(0, isNaN(lim) ? 50 : lim);
      const enriched = filtered.map(deal => addMetrics(deal, baselineMonthly));
      return res.json(enriched);
    } catch (e) {
      return res.status(500).json({ error: 'Failed to search deals' });
    }
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
