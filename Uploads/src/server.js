require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const path = require('path');

const authRoutes = require('./routes/auth');
const profileRoutes = require('./routes/profile');
const paymentRoutes = require('./routes/payments');
const brokerRoutes = require('./routes/broker');
const strategyRoutes = require('./routes/strategies');
const dashboardRoutes = require('./routes/dashboard');
const aiSupportRoutes = require('./routes/aiSupport');
const adminRoutes = require('./routes/admin');
const contentRoutes = require('./routes/content');

const app = express();

app.use(helmet());
app.use(cors({ origin: process.env.CLIENT_URL, credentials: true }));
app.use(express.json({ limit: '2mb' }));
app.use(morgan('combined'));
app.use('/uploads', express.static(path.join(__dirname, '../uploads')));

// Rate limit auth endpoints hard - this is a real target for credential stuffing
const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20 });
app.use('/api/auth', authLimiter, authRoutes);

app.use('/api/profile', profileRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/broker', brokerRoutes);
app.use('/api/strategies', strategyRoutes);
app.use('/api/dashboard', dashboardRoutes);
app.use('/api/support', aiSupportRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/content', contentRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

app.use((err, req, res, next) => {
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || 'Internal server error' });
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`KingBot API running on port ${PORT}`));
