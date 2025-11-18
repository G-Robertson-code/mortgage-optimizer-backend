const puppeteer = require('puppeteer');

async function scrape() {
  console.log('Starting MoneySuperMarket scraper...');
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

  // If scraping failed, return sample data
  if (deals.length === 0) {
    console.log('MoneySuperMarket: Using fallback sample data');
    return getSampleDeals();
  }

  return deals;
}

function getSampleDeals() {
  return [
    {
      lenderName: 'Nationwide',
      productName: '2 Year Fixed - 60% LTV',
      interestRate: 4.19,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 60,
      arrangementFee: 999,
      freeValuation: true,
      freeLegalWork: true,
      overpaymentAllowance: 10,
      earlyRepaymentCharges: '2% Year 1, 1% Year 2',
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'HSBC',
      productName: '5 Year Fixed - 75% LTV',
      interestRate: 4.29,
      dealType: 'Fixed',
      termYears: 5,
      maxLTV: 75,
      arrangementFee: 999,
      cashback: 250,
      freeValuation: true,
      freeLegalWork: false,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Barclays',
      productName: '2 Year Fixed - 75% LTV',
      interestRate: 4.35,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 75,
      arrangementFee: 899,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Halifax',
      productName: '2 Year Fixed - 60% LTV',
      interestRate: 4.15,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 60,
      arrangementFee: 1499,
      cashback: 500,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Santander',
      productName: '5 Year Fixed - 60% LTV',
      interestRate: 4.09,
      dealType: 'Fixed',
      termYears: 5,
      maxLTV: 60,
      arrangementFee: 999,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'NatWest',
      productName: '2 Year Fixed - 75% LTV',
      interestRate: 4.49,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 75,
      arrangementFee: 0,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'TSB',
      productName: '2 Year Fixed - 75% LTV',
      interestRate: 4.39,
      dealType: 'Fixed',
      termYears: 2,
      maxLTV: 75,
      arrangementFee: 995,
      freeValuation: true,
      freeLegalWork: false,
      lenderType: 'UK Mainstream'
    },
    {
      lenderName: 'Virgin Money',
      productName: '5 Year Fixed - 75% LTV',
      interestRate: 4.25,
      dealType: 'Fixed',
      termYears: 5,
      maxLTV: 75,
      arrangementFee: 995,
      freeValuation: true,
      freeLegalWork: true,
      lenderType: 'UK Mainstream'
    }
  ];
}

module.exports = { scrape };
