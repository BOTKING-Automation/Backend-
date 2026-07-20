const nodemailer = require('nodemailer');
require('dotenv').config();

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: Number(process.env.SMTP_PORT) === 465,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
});

async function sendVerificationEmail(toEmail, code) {
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject: 'KingBot - Verify your email',
    html: `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto">
      <h2>Welcome to KingBot</h2>
      <p>Your email verification code is:</p>
      <p style="font-size:28px;font-weight:bold;letter-spacing:4px">${code}</p>
      <p>This code expires in 15 minutes. If you did not request this, ignore this email.</p>
    </div>`,
  });
}

async function sendPaymentDecisionEmail(toEmail, status, plan) {
  const subject = status === 'approved' ? 'Your KingBot subscription is active' : 'Payment could not be verified';
  const body = status === 'approved'
    ? `Your payment for the <b>${plan}</b> plan has been verified and your account is now active.`
    : `We could not verify your recent M-Pesa payment. Please contact support with your transaction code.`;
  return transporter.sendMail({
    from: process.env.EMAIL_FROM,
    to: toEmail,
    subject,
    html: `<div style="font-family:Arial,sans-serif">${body}</div>`,
  });
}

module.exports = { sendVerificationEmail, sendPaymentDecisionEmail };
