const puppeteer = require('puppeteer');
const fs = require('fs');

async function scrape() {
  console.log('Starting CompareTheMarket scraper...');
  const deals = [];

  let browser;
  try {
    const launchOptions = {
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-features=HttpsFirstBalancedModeAutoEnable'
      ]
    };

    try {
      const ep = puppeteer.executablePath();
      if (ep && fs.existsSync(ep)) {
        launchOptions.executablePath = ep;
      }
    } catch (_) {}

    browser = await puppeteer.launch(launchOptions);

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Compare The Market mortgage page
    const url = 'https://www.comparethemarket.com/mortgages/';

    console.log('Navigating to CompareTheMarket...');
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 60000 });

    // Extract any available deals
    const scrapedDeals = await page.evaluate(() => {
      const results = [];
      const cards = document.querySelectorAll('.result-card, .mortgage-product, [class*="product-card"]');

      cards.forEach(card => {
        try {
          const rateEl = card.querySelector('.rate, [class*="rate"], .apr');
          const rate = rateEl ? parseFloat(rateEl.textContent.replace(/[^0-9.]/g, '')) : null;

          const lenderEl = card.querySelector('.lender, .provider, [class*="lender"]');
          const lenderName = lenderEl ? lenderEl.textContent.trim() : 'Unknown Lender';

          const productEl = card.querySelector('.product, .title, [class*="product"]');
          const productName = productEl ? productEl.textContent.trim() : `${rate}% Mortgage`;

          if (rate && rate > 0 && rate < 15) {
            results.push({
              lenderName,
              productName,
              interestRate: rate,
              arrangementFee: 0,
              maxLTV: 75,
              dealType: 'Fixed',
              termYears: 2,
              freeValuation: false,
              freeLegalWork: false,
              lenderType: 'UK Mainstream'
            });
          }
        } catch (e) {
          // Skip
        }
      });

      return results;
    });

    deals.push(...scrapedDeals);
    console.log(`CompareTheMarket: Found ${deals.length} deals`);

  } catch (error) {
    console.error('CompareTheMarket scraper error:', error.message);
  } finally {
    if (browser) {
      await browser.close();
    }
  }

  return deals;
}

module.exports = { scrape };
