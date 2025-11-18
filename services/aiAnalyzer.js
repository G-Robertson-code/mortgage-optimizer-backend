const OpenAI = require('openai');
const { getLatestDeals, getUserProfile } = require('../database');

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY
});

/**
 * Uses GPT-4 to analyze mortgage deals and provide personalized recommendations
 */
async function analyzeNewDeals() {
  try {
    const userProfile = await getUserProfile();
    const deals = await getLatestDeals(20); // Get top 20 recent deals

    if (deals.length === 0) {
      console.log('No deals to analyze');
      return null;
    }

    const prompt = `
You are an expert mortgage advisor. Analyze these mortgage deals for a client with the following profile:

Current Situation:
- Outstanding Balance: £${userProfile.outstandingBalance}
- Current Monthly Payment: £${userProfile.currentMonthlyPayment}
- Current Deal Ends: ${userProfile.dealEndDate}
- Days Until Expiry: ${userProfile.daysUntilExpiry}
- Property Value: £${userProfile.propertyValue}
- LTV: ${userProfile.ltv}%
- Preferred Fixed Period: ${userProfile.preferredFixedPeriod} years
- Can Afford Fees: £${userProfile.maxUpfrontFees}

Available Deals:
${JSON.stringify(deals, null, 2)}

Please provide:
1. Top 3 recommended deals with clear reasoning
2. Comparison of total costs over 2, 5 years
3. Break-even analysis for each recommended deal
4. Any red flags or important considerations
5. Best overall deal recommendation

Format as JSON with this structure:
{
  "recommendations": [
    {
      "rank": 1,
      "dealId": "...",
      "lender": "...",
      "reasoning": "...",
      "breakEvenMonths": 12,
      "totalSavings2Years": 2500,
      "totalSavings5Years": 7200,
      "pros": ["...", "..."],
      "cons": ["...", "..."]
    }
  ],
  "overallRecommendation": "...",
  "urgencyLevel": "high|medium|low",
  "actionItems": ["...", "..."]
}
`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4-turbo-preview",
      messages: [
        {
          role: "system",
          content: "You are an expert UK mortgage advisor with deep knowledge of mortgage products, fees, and market trends."
        },
        {
          role: "user",
          content: prompt
        }
      ],
      response_format: { type: "json_object" },
      temperature: 0.3
    });

    const analysis = JSON.parse(completion.choices[0].message.content);

    // Save analysis to database
    await saveAnalysis(analysis);

    console.log('AI Analysis completed:', analysis.overallRecommendation);
    return analysis;

  } catch (error) {
    console.error('AI Analysis error:', error.message);
    throw error;
  }
}

/**
 * Analyzes a specific deal and provides detailed breakdown
 */
async function analyzeSingleDeal(deal, userProfile) {
  const prompt = `
Analyze this mortgage deal for the user:

Deal:
${JSON.stringify(deal, null, 2)}

User Profile:
${JSON.stringify(userProfile, null, 2)}

Provide detailed analysis including:
1. Is this a good deal? (Yes/No with reasoning)
2. Total cost over different periods
3. Break-even point
4. Hidden costs or fees to watch out for
5. Comparison vs staying on SVR
6. Risk assessment

Return as JSON.
`;

  const completion = await openai.chat.completions.create({
    model: "gpt-4-turbo-preview",
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  });

  return JSON.parse(completion.choices[0].message.content);
}

async function saveAnalysis(analysis) {
  // TODO: Implement database save
  console.log('Saving analysis to database...');
}

module.exports = {
  analyzeNewDeals,
  analyzeSingleDeal
};
