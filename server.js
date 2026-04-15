'use strict';

const express = require('express');
const cors = require('cors');
const Reclaim = require('@reclaimprotocol/js-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const algosdk = require('algosdk');

const app = express();
const PORT = process.env.PORT || 3001;
const CONTRACTS_DIR = path.join(__dirname, 'contracts');
const ABI_PATH = path.join(CONTRACTS_DIR, 'acre_abi.json');
const DEPLOYED_APP_PATH = path.join(CONTRACTS_DIR, 'deployed_testnet_app.json');

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
    methods: ['GET', 'POST', 'OPTIONS'],
  })
);
app.use(express.json({ limit: '2mb' }));

function requireEnv(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}${fallback ? ` (or ${fallback})` : ''}`);
  }
  return value;
}

function loadAppId() {
  const fromEnv = process.env.APP_ID || process.env.TESTNET_APP_ID;
  if (fromEnv) return Number(fromEnv);

  if (!fs.existsSync(DEPLOYED_APP_PATH)) {
    throw new Error('Missing app id. Set APP_ID/TESTNET_APP_ID or create contracts/deployed_testnet_app.json');
  }
  const deployedInfo = JSON.parse(fs.readFileSync(DEPLOYED_APP_PATH, 'utf8'));
  return Number(deployedInfo.appId);
}

function getContract() {
  if (!fs.existsSync(ABI_PATH)) {
    throw new Error('Missing contracts/acre_abi.json');
  }
  const abiSpec = JSON.parse(fs.readFileSync(ABI_PATH, 'utf8'));
  return new algosdk.ABIContract(abiSpec);
}

function getMethodByName(methodName) {
  const contract = getContract();
  const method = contract.methods.find((m) => m.name === methodName);
  if (!method) {
    throw new Error(`${methodName} method not found in ABI`);
  }
  return method;
}

function getAlgodClient() {
  const algodServer = requireEnv('ALGOD_SERVER', 'TESTNET_ALGOD_SERVER');
  const algodToken = process.env.ALGOD_TOKEN || process.env.TESTNET_ALGOD_TOKEN || '';
  return new algosdk.Algodv2(algodToken, algodServer, '');
}

function getVerifierAccount() {
  const verifierMnemonic = requireEnv('VERIFIER_MNEMONIC', 'DEPLOYER_MNEMONIC');
  return algosdk.mnemonicToSecretKey(verifierMnemonic);
}

function getAdminAccount() {
  const adminMnemonic = requireEnv('ADMIN_MNEMONIC', 'VERIFIER_MNEMONIC');
  return algosdk.mnemonicToSecretKey(adminMnemonic);
}

function normalizeAbiValue(value) {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Uint8Array || Buffer.isBuffer(value)) {
    return Buffer.from(value).toString('hex');
  }
  if (Array.isArray(value)) return value.map(normalizeAbiValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, normalizeAbiValue(v)])
    );
  }
  return value;
}

async function callReadMethod({
  methodName,
  methodArgs = [],
  appAccounts = [],
}) {
  const algodClient = getAlgodClient();
  const verifier = getVerifierAccount();
  const appId = loadAppId();
  const method = getMethodByName(methodName);
  const suggestedParams = await algodClient.getTransactionParams().do();

  const atc = new algosdk.AtomicTransactionComposer();
  atc.addMethodCall({
    appID: appId,
    method,
    sender: verifier.addr,
    signer: algosdk.makeBasicAccountTransactionSigner(verifier),
    suggestedParams,
    appAccounts,
    methodArgs,
  });

  const { methodResults } = await atc.simulate(algodClient);
  if (!methodResults?.length) {
    throw new Error(`No method result returned for ${methodName}`);
  }
  if (methodResults[0].decodeError) {
    throw methodResults[0].decodeError;
  }
  return normalizeAbiValue(methodResults[0].returnValue);
}

async function waitForConfirmation(client, txId, timeoutRounds = 30) {
  const status = await client.status().do();
  let currentRound = Number(status?.['last-round'] ?? status?.lastRound);

  if (!Number.isInteger(currentRound) || currentRound <= 0) {
    throw new Error(`Unable to determine current round: ${JSON.stringify(status)}`);
  }

  const startRound = currentRound;

  while (currentRound < startRound + timeoutRounds) {
    const pending = await client.pendingTransactionInformation(txId).do();

    // ✅ If confirmed → return
    if (pending['confirmed-round'] && pending['confirmed-round'] > 0) {
      return pending;
    }

    // ❌ If rejected → fail early
    if (pending['pool-error'] && pending['pool-error'].length > 0) {
      throw new Error(`Transaction rejected: ${pending['pool-error']}`);
    }

    currentRound++;
    await client.statusAfterBlock(currentRound).do();
  }

  // 🔁 FINAL CHECK (this is what your version is missing)
  const finalPending = await client.pendingTransactionInformation(txId).do();

  if (finalPending['confirmed-round'] && finalPending['confirmed-round'] > 0) {
    console.log("⚠️ Confirmed after timeout window");
    return finalPending;
  }

  throw new Error(`Transaction not confirmed in ${timeoutRounds} rounds: ${txId}`);
}

function toStrictBytes32(hexHash) {
  if (typeof hexHash !== 'string' || !/^[0-9a-fA-F]{64}$/.test(hexHash)) {
    throw new Error('Invalid proof hash: expected 64 hex characters');
  }
  const buf = Buffer.from(hexHash, 'hex');
  if (buf.length !== 32) {
    throw new Error('Invalid proof hash: expected 32 bytes');
  }
  return buf;
}

function parseClaimContext(claimData) {
  const raw = claimData?.context;
  if (!raw) return {};
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw);
    } catch {
      return {};
    }
  }
  if (typeof raw === 'object') {
    return raw;
  }
  return {};
}

async function assertUserOptedIn(algodClient, address, appId) {
  try {
    await algodClient.accountApplicationInformation(address, appId).do();
  } catch (error) {
    const message = error?.message || '';
    if (message.includes('account application info not found')) {
      throw new Error('User must opt in to the app before verification');
    }
    throw error;
  }
}

async function callVerifyIncomeOnChain({
  walletAddress,
  tier,
  creditLimit,
  timestamp,
  proofHashHex,
  riderCount,
  riderRating,
  platform,
}) {
  const algodClient = getAlgodClient();
  const verifierSk = getVerifierAccount();
  const appId = loadAppId();
  const method = getMethodByName('verify_income');

  await assertUserOptedIn(algodClient, walletAddress, appId);

  const atc = new algosdk.AtomicTransactionComposer();
  const suggestedParams = await algodClient.getTransactionParams().do();
  const proofHashBytes = toStrictBytes32(proofHashHex);

  atc.addMethodCall({
    appID: appId,
    method,
    sender: verifierSk.addr,
    signer: algosdk.makeBasicAccountTransactionSigner(verifierSk),
    suggestedParams,
    appAccounts: [walletAddress],
    methodArgs: [
      walletAddress,
      tier,
      creditLimit,
      timestamp,
      proofHashBytes,
      riderCount,
      riderRating,
      platform,
    ],
  });

  const executeResult = await atc.execute(algodClient, 4);
  const txId = executeResult.txIDs[0];
  await algosdk.waitForConfirmation(algodClient, txId, 4);
  return txId;
}

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

app.get('/api/user/:address/eligibility', async (req, res) => {
  try {
    const { address } = req.params;
    const value = await callReadMethod({
      methodName: 'get_eligibility',
      methodArgs: [address],
      appAccounts: [address],
    });
    return res.json({ success: true, address, eligibility: value });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch eligibility' });
  }
});

app.get('/api/user/:address/verified', async (req, res) => {
  try {
    const { address } = req.params;
    const value = await callReadMethod({
      methodName: 'is_verified',
      methodArgs: [address],
      appAccounts: [address],
    });
    return res.json({ success: true, address, verified: Number(value) === 1 });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch verification status' });
  }
});

app.get('/api/user/:address/tier', async (req, res) => {
  try {
    const { address } = req.params;
    const value = await callReadMethod({
      methodName: 'get_tier',
      methodArgs: [address],
      appAccounts: [address],
    });
    return res.json({ success: true, address, tier: value });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch tier' });
  }
});

app.get('/api/user/:address/credit-limit', async (req, res) => {
  try {
    const { address } = req.params;
    const value = await callReadMethod({
      methodName: 'get_credit_limit',
      methodArgs: [address],
      appAccounts: [address],
    });
    return res.json({ success: true, address, creditLimit: value });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch credit limit' });
  }
});

app.get('/api/user/:address/full-profile', async (req, res) => {
  try {
    const { address } = req.params;
    const value = await callReadMethod({
      methodName: 'get_full_profile',
      methodArgs: [address],
      appAccounts: [address],
    });
    const [verified, tier, creditLimit, timestamp, riderCount, riderRating, platform] = Array.isArray(value) ? value : [];
    return res.json({
      success: true,
      address,
      profile: {
        verified: Number(verified) === 1,
        tier,
        creditLimit,
        timestamp,
        riderCount,
        riderRating,
        platform,
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch full profile' });
  }
});

app.get('/api/user/:address/proof-hash', async (req, res) => {
  try {
    const { address } = req.params;
    const value = await callReadMethod({
      methodName: 'get_proof_hash',
      methodArgs: [address],
      appAccounts: [address],
    });
    return res.json({ success: true, address, proofHash: value });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch proof hash' });
  }
});

app.get('/api/verifier', async (_req, res) => {
  try {
    const verifier = await callReadMethod({ methodName: 'get_verifier' });
    return res.json({ success: true, verifier });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch verifier' });
  }
});

app.get('/api/admin', async (_req, res) => {
  try {
    const admin = await callReadMethod({ methodName: 'get_admin' });
    return res.json({ success: true, admin });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch admin' });
  }
});

app.get('/api/proof-count', async (_req, res) => {
  try {
    const proofCount = await callReadMethod({ methodName: 'get_proof_count' });
    return res.json({ success: true, proofCount });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch proof count' });
  }
});

app.post('/api/update-verifier', async (req, res) => {
  try {
    const { newVerifier } = req.body || {};
    if (!newVerifier || !algosdk.isValidAddress(newVerifier)) {
      return res.status(400).json({ success: false, message: 'Invalid or missing newVerifier address' });
    }

    const algodClient = getAlgodClient();
    const admin = getAdminAccount();
    const appId = loadAppId();
    const method = getMethodByName('update_verifier');
    const suggestedParams = await algodClient.getTransactionParams().do();

    const atc = new algosdk.AtomicTransactionComposer();
    atc.addMethodCall({
      appID: appId,
      method,
      sender: admin.addr,
      signer: algosdk.makeBasicAccountTransactionSigner(admin),
      suggestedParams,
      methodArgs: [newVerifier],
    });

    const result = await atc.execute(algodClient, 4);
    const txId = result.txIDs[0];
    await algosdk.waitForConfirmation(algodClient, txId, 4);

    return res.json({ success: true, txId, newVerifier });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to update verifier' });
  }
});

app.post('/verify-proof', async (req, res) => {
  try {
    const { proof, walletAddress } = req.body || {};

    if (!proof) {
      return res.status(400).json({ 
        success: false, 
        message: 'Missing proof' 
      });
    }
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        message: 'Missing walletAddress',
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
    const context = parseClaimContext(claimData);

    if (context.contextAddress && context.contextAddress !== walletAddress) {
      throw new Error('Wallet mismatch with proof');
    }
    
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
    const riderCount = Number(driverData.tripsCompleted);
    const riderRating = Math.round(Number(driverData.driverRating) * 100);
    const proofTimestamp = Number(claimData?.timestampS);
    const timestamp = Number.isFinite(proofTimestamp) && proofTimestamp > 0
      ? Math.floor(proofTimestamp)
      : Math.floor(Date.now() / 1000);

    const txId = await callVerifyIncomeOnChain({
      walletAddress,
      tier,
      creditLimit,
      timestamp,
      proofHashHex: proofHash,
      riderCount,
      riderRating,
      platform: 'uber',
    });

    console.log('\n╔══════════════════════════════════════════════════════════════════╗');
    console.log('║              💰 CREDIT DECISION                                 ║');
    console.log('╠══════════════════════════════════════════════════════════════════╣');
    console.log('║ TRIPS:', driverData.tripsCompleted);
    console.log('║ RATING:', driverData.driverRating);
    console.log('║ MONTHLY EARNINGS: ₹' + driverData.monthlyEarnings.toLocaleString());
    console.log('║ TIER:', tier);
    console.log('║ CREDIT LIMIT: ₹' + creditLimit.toLocaleString());
    console.log('║ TX ID:', txId);
    console.log('║ REASON:', reason);
    console.log('╚══════════════════════════════════════════════════════════════════╝\n');

    return res.json({
      success: true,
      tier,
      creditLimit,
      txId,
      message: `${reason}: ₹${driverData.monthlyEarnings.toLocaleString()}/month`,
    });

  } catch (error) {
    console.error('\n❌ VERIFICATION ERROR:', error);
    if ((error?.message || '').includes('User must opt in to the app before verification')) {
      return res.status(409).json({
        success: false,
        needsOptIn: true,
        message: error.message,
      });
    }
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
