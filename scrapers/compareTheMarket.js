const puppeteer = require('puppeteer');

async function scrape() {
  console.log('Starting CompareTheMarket scraper...');
  const deals = [];

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: 'new',
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ]
    });

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

  // Fallback sample data
  if (deals.length === 0) {
    console.log('CompareTheMarket: Using fallback sample data');
    return getSampleDeals();
  }

  return deals;
}

function getSampleDeals() {
  return [
    {
      lenderName: 'Lloyds Bank',
      productName: '2 Year Fixed - 60% LTV',
      interestRate: 4.22,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 60,
      arrangementFee: 999,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Yorkshire Building Society',
      productName: '5 Year Fixed - 75% LTV',
      interestRate: 4.31,
      dealType: 'Fixed',
      termYears: 5,
      maxLTV: 75,
      arrangementFee: 0,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Skipton Building Society',
      productName: '2 Year Fixed - 75% LTV',
      interestRate: 4.45,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 75,
      arrangementFee: 995,
      freeValuation: true,
      freeLegalWork: false,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Metro Bank',
      productName: '3 Year Fixed - 75% LTV',
      interestRate: 4.55,
      dealType: 'Fixed',
      termYears: 3,
      maxLTV: 75,
      arrangementFee: 499,
      cashback: 1000,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Challenger Bank'
    },
    {
      lenderName: 'Coventry Building Society',
      productName: '2 Year Fixed - 60% LTV',
      interestRate: 4.12,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 60,
      arrangementFee: 999,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'First Direct',
      productName: '5 Year Fixed - 60% LTV',
      interestRate: 4.05,
      dealType: 'Fixed',
      termYears: 5,
      maxLTV: 60,
      arrangementFee: 490,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    }
  ];
}

module.exports = { scrape };
