'use strict';

const express = require('express');
const cors = require('cors');
const Reclaim = require('@reclaimprotocol/js-sdk');

const app = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://localhost:5173,http://127.0.0.1:5173'
)
  .split(',')
  .map((origin) => origin.trim())
  .filter(Boolean);

app.use(
  cors({
    origin(origin, callback) {
      // Allow non-browser requests (no Origin header), and configured browser origins.
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    methods: ['POST', 'OPTIONS'],
  })
);
app.use(express.json({ limit: '2mb' }));

/**
 * Step 6-7 endpoint:
 * Receives proof from frontend, verifies signature/integrity with Reclaim SDK,
 * extracts income_band, and returns verified tier.
 */
app.post('/verify-proof', async (req, res) => {
  try {
    const { proof } = req.body || {};

    if (!proof) {
      return res.status(400).json({ success: false, message: 'Missing proof in request body' });
    }

    // Verify proof signature + witness integrity before reading data.
    const isValid = await Reclaim.verifyProof(proof);
    if (!isValid) {
      return res.status(400).json({ success: false, message: 'Invalid proof signature' });
    }

    // Extract claim data in a defensive way (proof shape can vary by provider/config).
    const claimData = proof?.claimData || {};
    const rawData = claimData?.data;

    let parsedData = rawData;
    if (typeof rawData === 'string') {
      try {
        parsedData = JSON.parse(rawData);
      } catch {
        parsedData = {};
      }
    }

    const incomeBand = Number(parsedData?.income_band);

    if (![1, 2, 3].includes(incomeBand)) {
      return res.status(400).json({
        success: false,
        message: 'income_band missing or invalid (expected 1, 2, or 3)',
      });
    }

    // Debug logging for hackathon MVP iteration.
    console.log('Verified proof claimData:', claimData);
    console.log('Extracted income_band:', incomeBand);

    return res.json({
      success: true,
      tier: incomeBand,
      provider: 'uber',
      message: 'Verified',
    });
  } catch (error) {
    console.error('Proof verification error:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal verification error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`Acre Reclaim backend listening on http://localhost:${PORT}`);
});
