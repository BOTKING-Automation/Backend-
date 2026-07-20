// Africa's Talking is a real SMS gateway that works natively with Safaricom/Airtel
// numbers in Kenya - sign up at africastalking.com to get AT_USERNAME / AT_API_KEY.
require('dotenv').config();
const AfricasTalking = require('africastalking');

const at = AfricasTalking({
  apiKey: process.env.AT_API_KEY,
  username: process.env.AT_USERNAME,
});
const sms = at.SMS;

async function sendVerificationSMS(phone, code) {
  return sms.send({
    to: [phone.startsWith('+') ? phone : `+254${phone.replace(/^0/, '')}`],
    message: `KingBot verification code: ${code}. Valid for 15 minutes. Do not share this code.`,
    from: process.env.AT_SENDER_ID || undefined,
  });
}

module.exports = { sendVerificationSMS };
