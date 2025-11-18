const puppeteer = require('puppeteer');
const { saveDeal } = require('../database/dealRepository');

/**
 * Scrapes mortgage deals from MoneySuperMarket
 * @param {Object} userProfile - User's mortgage requirements
 */
async function scrapeMoneySuperMarket(userProfile) {
  console.log('Scraping MoneySuperMarket...');

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });

  try {
    const page = await browser.newPage();

    // Navigate to mortgage comparison page
    await page.goto('https://www.moneysupermarket.com/mortgages/remortgage/', {
      waitUntil: 'networkidle2'
    });

    // Fill in user details
    const { outstandingBalance, propertyValue, remainingTermYears } = userProfile;
    const ltv = ((outstandingBalance / propertyValue) * 100).toFixed(0);

    // Fill form (selectors may need updating based on actual site structure)
    await page.waitForSelector('input[name="propertyValue"]', { timeout: 5000 });
    await page.type('input[name="propertyValue"]', propertyValue.toString());
    await page.type('input[name="loanAmount"]', outstandingBalance.toString());
    await page.select('select[name="mortgageTerm"]', remainingTermYears.toString());

    // Submit and wait for results
    await page.click('button[type="submit"]');
    await page.waitForNavigation({ waitUntil: 'networkidle2' });

    // Extract deals
    const deals = await page.evaluate(() => {
      const dealElements = document.querySelectorAll('.mortgage-result');
      return Array.from(dealElements).map(element => {
        return {
          lenderName: element.querySelector('.lender-name')?.textContent.trim(),
          productName: element.querySelector('.product-name')?.textContent.trim(),
          interestRate: parseFloat(element.querySelector('.interest-rate')?.textContent.match(/[\d.]+/)?.[0]),
          monthlyPayment: parseFloat(element.querySelector('.monthly-payment')?.textContent.match(/[\d.]+/)?.[0]),
          arrangementFee: parseFloat(element.querySelector('.arrangement-fee')?.textContent.match(/[\d.]+/)?.[0]) || 0,
          productFee: parseFloat(element.querySelector('.product-fee')?.textContent.match(/[\d.]+/)?.[0]) || 0,
          fixedPeriod: element.querySelector('.fixed-period')?.textContent.match(/\d+/)?.[0],
          maxLTV: parseFloat(element.querySelector('.max-ltv')?.textContent.match(/[\d.]+/)?.[0]),
          earlyRepaymentCharge: element.querySelector('.erc')?.textContent.trim(),
          applyUrl: element.querySelector('.apply-button')?.href,
          source: 'MoneySuperMarket'
        };
      }).filter(deal => deal.lenderName && deal.interestRate);
    });

    console.log(`Found ${deals.length} deals on MoneySuperMarket`);

    // Save deals to database
    for (const deal of deals) {
      await saveDeal({
        ...deal,
        scrapedAt: new Date(),
        userLTV: ltv
      });
    }

    return deals;

  } catch (error) {
    console.error('MoneySuperMarket scraping error:', error.message);
    throw error;
  } finally {
    await browser.close();
  }
}

module.exports = scrapeMoneySuperMarket;
