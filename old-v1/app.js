const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const transcribeRoutes = require('./routes/transcribeRoutes');
const errorHandler = require('./middleware/errorHandler');

const app = express();

// Middleware
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan('dev'));

// Routes
app.use('/transcribe', transcribeRoutes);

// Basic health check
app.get('/health', (req, res) => {
    res.json({ status: 'ok' });
});

// Error handling
app.use(errorHandler);

module.exports = app;
