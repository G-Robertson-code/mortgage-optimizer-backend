const nodemailer = require('nodemailer');
const twilio = require('twilio');

const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID,
  process.env.TWILIO_AUTH_TOKEN
);

// Email transporter
const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

/**
 * Checks conditions and sends alerts to user
 */
async function checkAndSendAlerts() {
  const { getUserProfile, getLatestAnalysis, getTopDeals } = require('../database');

  try {
    const user = await getUserProfile();
    const analysis = await getLatestAnalysis();
    const topDeals = await getTopDeals(3);

    // Alert conditions
    const alerts = [];

    // 1. Deal expiring soon
    if (user.daysUntilExpiry <= 30 && user.daysUntilExpiry > 0) {
      alerts.push({
        type: 'DEAL_EXPIRING',
        urgency: 'high',
        message: `⚠️ Your mortgage deal expires in ${user.daysUntilExpiry} days! You'll move to SVR (£${user.svrMonthlyPayment}/month)`,
        action: 'Review and apply for new deals immediately'
      });
    }

    // 2. Great deal found
    if (analysis && analysis.recommendations.length > 0) {
      const bestDeal = analysis.recommendations[0];
      const monthlySaving = user.currentMonthlyPayment - bestDeal.monthlyPayment;

      if (monthlySaving > 50) { // Saving more than £50/month
        alerts.push({
          type: 'GREAT_DEAL_FOUND',
          urgency: 'medium',
          message: `💰 Found excellent deal: ${bestDeal.lender} - Save £${monthlySaving.toFixed(0)}/month (£${(monthlySaving * 12).toFixed(0)}/year)`,
          action: `Apply now: ${bestDeal.applyUrl || 'Check your app'}`
        });
      }
    }

    // 3. Rate dropped significantly
    if (topDeals.length > 0) {
      const lowestRate = Math.min(...topDeals.map(d => d.interestRate));
      const currentRate = user.currentRate || 5.0;

      if (lowestRate < currentRate - 0.5) {
        alerts.push({
          type: 'RATE_DROP',
          urgency: 'medium',
          message: `📉 Rates dropped! Best rate now: ${lowestRate.toFixed(2)}% (was ${currentRate.toFixed(2)}%)`,
          action: 'Review new deals in your app'
        });
      }
    }

    // 4. SVR warning
    if (user.daysUntilExpiry <= 0) {
      alerts.push({
        type: 'ON_SVR',
        urgency: 'critical',
        message: `🚨 You're on SVR! Paying £${(user.svrMonthlyPayment - user.currentMonthlyPayment).toFixed(0)} EXTRA per month`,
        action: 'Switch IMMEDIATELY to save money'
      });
    }

    // Send alerts
    if (alerts.length > 0) {
      await sendEmailAlert(user.email, alerts);

      if (user.phoneNumber && alerts.some(a => a.urgency === 'high' || a.urgency === 'critical')) {
        await sendSMSAlert(user.phoneNumber, alerts.filter(a => a.urgency === 'high' || a.urgency === 'critical'));
      }

      console.log(`Sent ${alerts.length} alerts to user`);
    }

    return alerts;

  } catch (error) {
    console.error('Alert service error:', error.message);
    throw error;
  }
}

/**
 * Sends email alert
 */
async function sendEmailAlert(email, alerts) {
  const urgentAlerts = alerts.filter(a => a.urgency === 'high' || a.urgency === 'critical');
  const subject = urgentAlerts.length > 0
    ? '🚨 URGENT: Mortgage Action Required'
    : '💰 New Mortgage Deals Available';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <style>
        body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
        .alert { padding: 15px; margin: 10px 0; border-radius: 5px; }
        .critical { background: #fee; border-left: 4px solid #c00; }
        .high { background: #ffe; border-left: 4px solid #f90; }
        .medium { background: #eff; border-left: 4px solid #09f; }
        .action { background: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block; margin-top: 10px; }
      </style>
    </head>
    <body>
      <h2>Mortgage Optimizer Alert</h2>
      ${alerts.map(alert => `
        <div class="alert ${alert.urgency}">
          <h3>${alert.message}</h3>
          <p><strong>Recommended Action:</strong> ${alert.action}</p>
        </div>
      `).join('')}
      <p><a href="${process.env.APP_URL || 'mortgageapp://open'}" class="action">Open Mortgage App</a></p>
      <hr>
      <p style="font-size: 12px; color: #666;">
        This is an automated alert from your Mortgage Optimizer.
        <br>Don't want these emails? <a href="#">Unsubscribe</a>
      </p>
    </body>
    </html>
  `;

  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: subject,
    html: htmlContent
  };

  await transporter.sendMail(mailOptions);
  console.log('Email alert sent to:', email);
}

/**
 * Sends SMS alert for urgent items
 */
async function sendSMSAlert(phoneNumber, alerts) {
  const message = alerts.map(a => a.message).join('\n\n');

  await twilioClient.messages.create({
    body: `MORTGAGE ALERT:\n\n${message}\n\nOpen your app for details.`,
    from: process.env.TWILIO_PHONE_NUMBER,
    to: phoneNumber
  });

  console.log('SMS alert sent to:', phoneNumber);
}

/**
 * Send custom notification
 */
async function sendCustomAlert(email, subject, message) {
  const mailOptions = {
    from: process.env.EMAIL_USER,
    to: email,
    subject: subject,
    html: `<div style="font-family: Arial, sans-serif;">${message}</div>`
  };

  await transporter.sendMail(mailOptions);
}

module.exports = {
  checkAndSendAlerts,
  sendEmailAlert,
  sendSMSAlert,
  sendCustomAlert
};
