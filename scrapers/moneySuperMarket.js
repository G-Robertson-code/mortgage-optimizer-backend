const puppeteer = require('puppeteer');
const fs = require('fs');

function resolveChromiumPath() {
  const envPath = process.env.PUPPETEER_EXECUTABLE_PATH || process.env.CHROMIUM_PATH;
  const candidates = [
    envPath,
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable'
  ].filter(Boolean);
  for (const p of candidates) {
    try {
      if (fs.existsSync(p)) return p;
    } catch (_) {}
  }
  return null;
}

async function scrape() {
  console.log('Starting MoneySuperMarket scraper...');
  const deals = [];

  let browser;
  try {
    const executablePath = resolveChromiumPath();

    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    };

    if (executablePath) {
      launchOptions.executablePath = executablePath;
    }

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // MoneySuperMarket mortgage results page
    const url = 'https://www.moneysupermarket.com/mortgages/remortgage/results/';

    console.log('Navigating to MoneySuperMarket...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Wait for results to load
    await page.waitForSelector('[data-testid="result-card"], .result-card, .mortgage-result', { timeout: 15000 }).catch(() => {
      console.log('MoneySuperMarket: No result cards found');
    });

    // Extract deals from the page
    const scrapedDeals = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('[data-testid="result-card"], .result-card, .mortgage-result, [class*="ResultCard"]');

      cards.forEach(card => {
        try {
          const rateEl = card.querySelector('[data-testid="rate"], .rate, [class*="rate"], .interest-rate');
          const rate = rateEl ? parseFloat(rateEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const lenderEl = card.querySelector('[data-testid="lender"], .lender-name, [class*="lender"], .provider-name');
          const lenderName = lenderEl ? lenderEl.textContent.trim() : 'Unknown Lender';

          const productEl = card.querySelector('[data-testid="product"], .product-name, [class*="product"]');
          const productName = productEl ? productEl.textContent.trim() : `${rate}% Mortgage`;

          const feeEl = card.querySelector('[data-testid="fee"], .fee, [class*="fee"]');
          const fee = feeEl ? parseFloat(feeEl.textContent.replace(/[^0-9.]/g, '')) : 0;

          const ltvEl = card.querySelector('[data-testid="ltv"], .ltv, [class*="ltv"]');
          const ltv = ltvEl ? parseFloat(ltvEl.textContent.replace(/[^0-9.]/g, '')) : 75;

          if (rate && rate > 0 && rate < 15) {
            results.push({
              lenderName,
              productName,
              interestRate: rate,
              arrangementFee: fee || 0,
              maxLTV: ltv || 75,
              dealType: 'Fixed',
              termYears: 2,
              freeValuation: false,
              freeLegalWork: false,
              lenderType: 'UK Mainstream'
            });
          }
        } catch (e) {
          // Skip problematic cards
        }
      });

      return results;
    });

    deals.push(...scrapedDeals);
    console.log(`MoneySuperMarket: Found ${deals.length} deals`);

  } catch (error) {
    console.error('MoneySuperMarket scraper error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return deals;
}

module.exports = { scrape };
