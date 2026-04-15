'use strict';

const express = require('express');
const cors = require('cors');
const Reclaim = require('@reclaimprotocol/js-sdk');
const crypto = require('crypto');

const app = express();
const PORT = process.env.PORT || 3001;

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

const allowedOriginPatterns = [
  /^https:\/\/id-preview--.*\.lovable\.app$/,
];

const corsOptions = {
  origin(origin, callback) {
    const isAllowedPattern = origin
      ? allowedOriginPatterns.some((pattern) => pattern.test(origin))
      : false;
    if (!origin || allowedOrigins.includes(origin) || isAllowedPattern) {
      return callback(null, true);
    }
    return callback(new Error(`Not allowed by CORS: ${origin}`));
  },
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
};

app.use(
  cors(corsOptions)
);
app.options(/.*/, cors(corsOptions));
app.use(express.json({ limit: '2mb' }));

app.get('/', (_req, res) => {
  res.send('API is running');
});

/**
 * NEW PROVIDER: uber-profile-ride-history
 * Returns: rider_count, rider_rating, email, mobile
 * Maps ride activity to credit tiers (not exact income)
 */
app.post('/verify-proof', async (req, res) => {
  const requestId = crypto.randomUUID().slice(0, 8);
  const log = (...args) => console.log(`[${requestId}]`, ...args);

  try {
    log('[1] Request received');

    const { proof } = req.body || {};

    if (!proof) {
      log('[2] Missing proof → rejecting');
      return res.status(400).json({ success: false, message: 'Missing proof' });
    }

    log('[3] Proof received, starting verification');

    const isValid = await Reclaim.verifyProof(proof);

    log('[4] Verification result:', isValid);

    if (!isValid) {
      log('[5] Invalid proof → rejecting');
      return res.status(400).json({ success: false, message: 'Invalid proof signature' });
    }

    log('[6] Extracting claim data');

    const claimData = proof?.claimData || {};
    const rawData = claimData?.data;

    let parsedData = rawData;

    if (typeof rawData === 'string') {
      log('[7] Raw data is string → parsing JSON');
      try {
        parsedData = JSON.parse(rawData);
        log('[8] JSON parsed successfully');
      } catch {
        log('[8] JSON parsing failed → fallback to empty object');
        parsedData = {};
      }
    }

    log('[9] Parsed data keys:', Object.keys(parsedData || {}));

    const riderCount = parseInt(
      parsedData?.rider_count ||
      parsedData?.rides ||
      parsedData?.rideCount ||
      parsedData?.total_rides ||
      parsedData?.tripCount ||
      parsedData?.trips ||
      0
    );

    const riderRating = parseFloat(
      parsedData?.rider_rating ||
      parsedData?.rating ||
      parsedData?.avg_rating ||
      0
    );

    log('[10] Extracted values:', { riderCount, riderRating });

    log('[11] Mapping to credit tier');

    let tier = 1;
    let creditLimit = 10000;

    if (riderCount >= 500 && riderRating >= 4.5) {
      tier = 3;
      creditLimit = 50000;
    } else if (riderCount >= 100 && riderRating >= 4.0) {
      tier = 2;
      creditLimit = 25000;
    }

    log('[12] Final decision:', { tier, creditLimit });

    log('[13] Sending response');

    return res.json({
      success: true,
      tier,
      creditLimit,
      riderCount,
      riderRating,
      rawFields: Object.keys(parsedData || {}),
      provider: 'uber-profile-ride-history',
      message: `Verified with ${riderCount} rides`,
    });

  } catch (error) {
    console.error(`[${requestId}] [ERROR]`, error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Acre backend listening on http://localhost:${PORT}`);
  console.log(`Provider: uber-profile-ride-history (ride count + rating → credit tier)`);
});
