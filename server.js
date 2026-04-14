'use strict';

const express = require('express');
const cors = require('cors');
const Reclaim = require('@reclaimprotocol/js-sdk');
const crypto = require('crypto');

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
      if (!origin || allowedOrigins.includes(origin)) {
        return callback(null, true);
      }
      return callback(new Error(`Not allowed by CORS: ${origin}`));
    },
    methods: ['POST', 'OPTIONS'],
  })
);
app.use(express.json({ limit: '2mb' }));

function generateDriverData() {
  const tripsCompleted = Math.floor(Math.random() * 2500) + 500;
  const driverRating = (Math.random() * 0.5 + 4.5).toFixed(2);
  const accountAgeMonths = Math.floor(Math.random() * 42) + 6;
  const weeklyEarnings = Math.floor(Math.random() * 7000) + 8000;
  const monthlyEarnings = weeklyEarnings * 4;
  
  return {
    tripsCompleted,
    driverRating: parseFloat(driverRating),
    accountAgeMonths,
    weeklyEarnings,
    monthlyEarnings
  };
}

function calculateCreditTier(driverData) {
  const { tripsCompleted, driverRating, monthlyEarnings, accountAgeMonths } = driverData;
  
  let tier = 1;
  let creditLimit = 10000;
  let reason = 'New driver';
  
  if (tripsCompleted >= 2000 && driverRating >= 4.8 && monthlyEarnings >= 50000) {
    tier = 3;
    creditLimit = 50000;
    reason = 'Elite driver';
  } else if (tripsCompleted >= 1000 && driverRating >= 4.6 && monthlyEarnings >= 30000) {
    tier = 2;
    creditLimit = 25000;
    reason = 'Established driver';
  } else if (accountAgeMonths >= 6) {
    tier = 1;
    creditLimit = 10000;
    reason = 'Growing driver';
  }
  
  return { tier, creditLimit, reason };
}

/**
 * Extract UID from nested parameters JSON
 */
function extractUid(claimData) {
  try {
    let uid = claimData?.uid || claimData?.userId || claimData?.user_id || claimData?.sub || claimData?.id;
    if (uid) return uid;
    
    const params = claimData?.parameters;
    if (typeof params === 'string') {
      const parsed = JSON.parse(params);
      
      uid = parsed?.extractedParameters?.uid ||
            parsed?.extractedParameters?.userId ||
            parsed?.extractedParameters?.user_id ||
            parsed?.extractedParameters?.sub ||
            parsed?.extractedParameters?.id;
      
      if (uid) return uid;
      
      uid = parsed?.paramValues?.uid ||
            parsed?.paramValues?.userId ||
            parsed?.paramValues?.user_id;
      
      if (uid) return uid;
    }
    
    const context = claimData?.context;
    if (typeof context === 'string') {
      const parsedContext = JSON.parse(context);
      uid = parsedContext?.extractedParameters?.uid ||
            parsedContext?.extractedParameters?.userId;
      if (uid) return uid;
    }
    
  } catch (e) {
    console.log('UID extraction parse error:', e.message);
  }
  
  return null;
}

/**
 * Extract email from nested data
 */
function extractEmail(claimData) {
  try {
    const params = claimData?.parameters;
    if (typeof params === 'string') {
      const parsed = JSON.parse(params);
      return parsed?.extractedParameters?.email ||
             parsed?.extractedParameters?.emailAddress ||
             parsed?.extractedParameters?.userEmail;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

/**
 * Pretty print proof structure
 */
function logProofStructure(proof) {
  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║                    📋 FULL PROOF STRUCTURE                        ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  
  // Top-level fields
  console.log('║ TOP-LEVEL FIELDS:');
  console.log('║   • identifier:', proof?.identifier?.slice(0, 30) + '...' || 'undefined');
  console.log('║   • epoch:', proof?.epoch);
  console.log('║   • publicData:', proof?.publicData || 'null');
  
  // Claim Data
  console.log('║');
  console.log('║ 📦 CLAIM DATA:');
  const claimData = proof?.claimData || {};
  console.log('║   • provider:', claimData?.provider);
  console.log('║   • owner:', claimData?.owner?.slice(0, 20) + '...' || 'undefined');
  console.log('║   • timestampS:', claimData?.timestampS, `(${new Date(claimData?.timestampS * 1000).toISOString()})`);
  console.log('║   • identifier:', claimData?.identifier?.slice(0, 30) + '...' || 'undefined');
  console.log('║   • epoch:', claimData?.epoch);
  
  // Parameters (parsed)
  console.log('║');
  console.log('║ 🔧 PARAMETERS (parsed from JSON):');
  try {
    const params = typeof claimData?.parameters === 'string' 
      ? JSON.parse(claimData.parameters) 
      : claimData?.parameters;
    
    if (params) {
      console.log('║   • url:', params?.url?.slice(0, 50) + '...' || 'undefined');
      console.log('║   • method:', params?.method);
      console.log('║   • body length:', params?.body?.length || 0, 'chars');
      
      console.log('║');
      console.log('║   📊 EXTRACTED PARAMETERS:');
      const extracted = params?.extractedParameters || {};
      Object.entries(extracted).slice(0, 5).forEach(([key, value]) => {
        const displayValue = typeof value === 'string' && value.length > 40 
          ? value.slice(0, 40) + '...' 
          : value;
        console.log(`║     • ${key}:`, displayValue);
      });
      if (Object.keys(extracted).length > 5) {
        console.log(`║     ... and ${Object.keys(extracted).length - 5} more fields`);
      }
      
      console.log('║');
      console.log('║   🎯 PARAM VALUES:');
      const paramValues = params?.paramValues || {};
      Object.entries(paramValues).slice(0, 3).forEach(([key, value]) => {
        const displayValue = typeof value === 'string' && value.length > 40 
          ? value.slice(0, 40) + '...' 
          : value;
        console.log(`║     • ${key}:`, displayValue);
      });
    }
  } catch (e) {
    console.log('║   ⚠️ Could not parse parameters:', e.message);
  }
  
  // Context
  console.log('║');
  console.log('║ 📝 CONTEXT:');
  try {
    const context = typeof claimData?.context === 'string'
      ? JSON.parse(claimData.context)
      : claimData?.context;
    console.log('║   • contextAddress:', context?.contextAddress);
    console.log('║   • contextMessage:', context?.contextMessage);
    if (context?.extractedParameters) {
      console.log('║   • extractedParameters.uid:', context?.extractedParameters?.uid);
    }
  } catch (e) {
    console.log('║   ⚠️ Could not parse context');
  }
  
  // Signatures
  console.log('║');
  console.log('║ ✍️  SIGNATURES:');
  console.log('║   • count:', proof?.signatures?.length || 0);
  if (proof?.signatures?.[0]) {
    console.log('║   • first:', proof.signatures[0].slice(0, 40) + '...');
  }
  
  // Witnesses
  console.log('║');
  console.log('║ 👁️  WITNESSES:');
  proof?.witnesses?.forEach((w, i) => {
    console.log(`║   • [${i}] id:`, w?.id?.slice(0, 20) + '...');
    console.log(`║       url:`, w?.url);
  });
  
  console.log('╚══════════════════════════════════════════════════════════════════╝');
}

app.post('/verify-proof', async (req, res) => {
  try {
    const { proof, walletAddress } = req.body || {};

    if (!proof) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing proof' 
      });
    }

    // Generate proof hash
    const proofHash = crypto
      .createHash('sha256')
      .update(JSON.stringify(proof))
      .digest('hex');

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║              🔐 NEW VERIFICATION REQUEST                        ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║ PROOF HASH:', proofHash);
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    // Verify Reclaim proof
    const isValid = await Reclaim.verifyProof(proof);
    if (!isValid) {
      console.log('❌ PROOF VERIFICATION FAILED');
      return res.status(400).json({ 
        success: false, 
        message: 'Invalid proof signature' 
      });
    }
    console.log('✅ PROOF SIGNATURE VERIFIED');

    // Pretty print full proof structure
    logProofStructure(proof);

    const claimData = proof?.claimData || {};
    
    // Extract UID
    const uberUid = extractUid(claimData);
    const email = extractEmail(claimData);

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║              📊 EXTRACTED USER DATA                             ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║ UID:', uberUid || 'NOT FOUND (using fallback)');
    console.log('║ EMAIL:', email ? email.split('@')[0] + '@***' : 'not found');
    console.log('║ UID SOURCE:', uberUid ? 'real from proof' : 'proof hash fallback');
    console.log('╚══════════════════════════════════════════════════════════════════╝');

    const finalUid = uberUid || proofHash.slice(0, 16);

    // Generate driver data
    const driverData = generateDriverData();
    const { tier, creditLimit, reason } = calculateCreditTier(driverData);

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║              💰 CREDIT DECISION                                 ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║ TRIPS:', driverData.tripsCompleted);
    console.log('║ RATING:', driverData.driverRating);
    console.log('║ MONTHLY EARNINGS: ₹' + driverData.monthlyEarnings.toLocaleString());
    console.log('║ TIER:', tier);
    console.log('║ CREDIT LIMIT: ₹' + creditLimit.toLocaleString());
    console.log('║ REASON:', reason);
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    return res.json({
      success: true,
      tier,
      creditLimit,
      driverData,
      creditReason: reason,
      uberIdentity: {
        uid: finalUid,
        verified: !!uberUid,
        email: email || null
      },
      proofHash: proofHash,
      proofHashShort: proofHash.slice(0, 16) + '...',
      provider: 'uber-uid-verified',
      message: `${reason}: ₹${driverData.monthlyEarnings.toLocaleString()}/month`,
      demoNote: 'Driver earnings simulated for hackathon - real API in production'
    });

  } catch (error) {
    console.error('\n❌ VERIFICATION ERROR:', error);
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal verification error',
    });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Acre backend on http://localhost:${PORT}`);
  console.log(`📜 Proof logging enabled\n`);
});