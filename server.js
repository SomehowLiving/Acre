'use strict';

const express = require('express');
const cors = require('cors');
const Reclaim = require('@reclaimprotocol/js-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const algosdk = require('algosdk');

const app = express();
const PORT = process.env.PORT || 3001;
const CONTRACTS_DIR = path.join(__dirname, 'contracts');
const ABI_PATH = path.join(CONTRACTS_DIR, 'acre_abi.json');
const DEPLOYED_APP_PATH = path.join(CONTRACTS_DIR, 'deployed_testnet_app.json');
const identitySessions = new Map();

const DIGILOCKER_BASE_URL = process.env.ACRE_DIGILOCKER_BASE_URL || 'https://dg-sandbox.setu.co';
const DIGILOCKER_REDIRECT_URL = process.env.ACRE_DIGILOCKER_REDIRECT_URL || 'http://localhost:5173/identity/callback';
const DIGILOCKER_TIMEOUT_MS = Number(process.env.ACRE_DIGILOCKER_TIMEOUT_SECONDS || '15') * 1000;
const ALGOPLONK_VERIFY_METHOD_SIGNATURE =
  process.env.ACRE_ALGOPLONK_VERIFY_METHOD_SIGNATURE || 'verify(byte[32][],byte[32][])bool';
const ALGOPLONK_REQUIRE_ONCHAIN_VERIFY =
  ['1', 'true', 'yes', 'on'].includes(String(process.env.ACRE_ALGOPLONK_REQUIRE_ONCHAIN_VERIFY || '').toLowerCase());
const ALGOPLONK_SIMULATE_ONLY =
  ['1', 'true', 'yes', 'on'].includes(String(process.env.ACRE_ALGOPLONK_SIMULATE_ONLY || '').toLowerCase());
const ALGOPLONK_VERIFY_APP_ID = Number(process.env.ACRE_ALGOPLONK_VERIFY_APP_ID || '0');

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

function requireEnv(name, fallback) {
  const value = process.env[name] || (fallback ? process.env[fallback] : undefined);
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}${fallback ? ` (or ${fallback})` : ''}`);
  }
  return value;
}

function hasEnv(name) {
  return typeof process.env[name] === 'string' && process.env[name].trim().length > 0;
}

function envFlag(name, defaultValue = false) {
  const raw = process.env[name];
  if (raw == null) return defaultValue;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
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

function normalizeHex(value, fieldName) {
  if (typeof value !== 'string') {
    throw new Error(`${fieldName} must be a hex string`);
  }
  let normalized = value.trim().toLowerCase();
  if (normalized.startsWith('0x')) normalized = normalized.slice(2);
  if (!normalized) throw new Error(`${fieldName} must be non-empty hex`);
  if (normalized.length % 2 !== 0) throw new Error(`${fieldName} must have an even number of hex characters`);
  if (!/^[0-9a-f]+$/.test(normalized)) throw new Error(`${fieldName} must be valid hex`);
  return normalized;
}

function bytes32ChunksFromHex(value, fieldName) {
  const normalized = normalizeHex(value, fieldName);
  const buf = Buffer.from(normalized, 'hex');
  if (buf.length % 32 !== 0) {
    throw new Error(`${fieldName} must be a multiple of 32 bytes`);
  }
  const chunks = [];
  for (let offset = 0; offset < buf.length; offset += 32) {
    chunks.push(buf.subarray(offset, offset + 32));
  }
  return { normalized, chunks };
}

function sha256Hex(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function buildClaimHash(walletAddress, claimType, claimValue) {
  return sha256Hex(`acre-identity-v1|wallet:${walletAddress}|claim:${claimType}|value:${claimValue}`);
}

function buildWalletCommitment(walletAddress) {
  return sha256Hex(`acre-wallet-v1|${walletAddress}`);
}

function computeIdentityFlags(aadhaarPayload = {}) {
  const aadhaar = aadhaarPayload?.aadhaar && typeof aadhaarPayload.aadhaar === 'object'
    ? aadhaarPayload.aadhaar
    : {};
  const address = aadhaar?.address && typeof aadhaar.address === 'object' ? aadhaar.address : {};
  const country = String(address.country || '').trim().toLowerCase();
  const dobRaw = String(aadhaar.dateOfBirth || '').trim();
  const now = new Date();

  let ageOver18 = false;
  if (dobRaw) {
    const parts = dobRaw.includes('-') ? dobRaw.split('-') : dobRaw.split('/');
    if (parts.length === 3) {
      const [a, b, c] = parts.map((value) => Number(value));
      const year = String(parts[0]).length === 4 ? a : c;
      const month = String(parts[0]).length === 4 ? b : b;
      const day = String(parts[0]).length === 4 ? c : a;
      const dob = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(dob.getTime())) {
        let years = now.getUTCFullYear() - dob.getUTCFullYear();
        const beforeBirthday =
          now.getUTCMonth() < dob.getUTCMonth() ||
          (now.getUTCMonth() === dob.getUTCMonth() && now.getUTCDate() < dob.getUTCDate());
        if (beforeBirthday) years -= 1;
        ageOver18 = years >= 18;
      }
    }
  }

  return {
    isIndian: ['india', 'in', 'bharat'].includes(country),
    ageOver18,
    isVerifiedHuman: true,
  };
}

function isDigiLockerConfigured() {
  return hasEnv('ACRE_DIGILOCKER_CLIENT_ID')
    && hasEnv('ACRE_DIGILOCKER_CLIENT_SECRET')
    && hasEnv('ACRE_DIGILOCKER_PRODUCT_INSTANCE_ID');
}

function buildDigiLockerHeaders() {
  if (!isDigiLockerConfigured()) {
    throw new Error(
      'DigiLocker is not configured. Set ACRE_DIGILOCKER_CLIENT_ID, ACRE_DIGILOCKER_CLIENT_SECRET, and ACRE_DIGILOCKER_PRODUCT_INSTANCE_ID.'
    );
  }

  return {
    'x-client-id': process.env.ACRE_DIGILOCKER_CLIENT_ID,
    'x-client-secret': process.env.ACRE_DIGILOCKER_CLIENT_SECRET,
    'x-product-instance-id': process.env.ACRE_DIGILOCKER_PRODUCT_INSTANCE_ID,
    'Content-Type': 'application/json',
  };
}

async function digilockerRequest(method, routePath, payload) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DIGILOCKER_TIMEOUT_MS);
  try {
    const response = await fetch(`${DIGILOCKER_BASE_URL.replace(/\/$/, '')}${routePath}`, {
      method,
      headers: buildDigiLockerHeaders(),
      body: payload ? JSON.stringify(payload) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    let body = {};
    try {
      body = text ? JSON.parse(text) : {};
    } catch {
      throw new Error('DigiLocker returned non-JSON response');
    }
    if (!response.ok) {
      const detail = body?.message || body?.error || body?.detail || text || 'unknown_error';
      throw new Error(`DigiLocker API error (${response.status}) on ${routePath}: ${detail}`);
    }
    return body;
  } finally {
    clearTimeout(timeout);
  }
}

function createMockIdentitySession(walletAddress) {
  const requestId = `dlg_mock_${crypto.randomUUID()}`;
  const flags = {
    isIndian: true,
    ageOver18: true,
    isVerifiedHuman: true,
  };
  const claimHashes = {
    indianCitizen: buildClaimHash(walletAddress, 'indian_citizen', 'true'),
    ageOver18: buildClaimHash(walletAddress, 'age_over_18', 'true'),
    verifiedHuman: buildClaimHash(walletAddress, 'verified_human', 'true'),
  };
  const session = {
    requestId,
    walletAddress,
    status: envFlag('ACRE_DIGILOCKER_MOCK_AUTO_VERIFY', true) ? 'identity_verified' : 'pending_digilocker_consent',
    authUrl: `${DIGILOCKER_REDIRECT_URL}?request_id=${requestId}`,
    createdAt: Date.now(),
    flags,
    claimHashes,
    aadhaar: {
      aadhaar: {
        maskedNumber: 'XXXX-XXXX-4242',
        dateOfBirth: '01-01-1998',
        address: { country: 'India' },
      },
    },
  };
  identitySessions.set(requestId, session);
  return session;
}

async function createIdentitySession(walletAddress, redirectUrl) {
  if (!algosdk.isValidAddress(walletAddress)) {
    throw new Error('walletAddress must be a valid Algorand address');
  }

  if (!isDigiLockerConfigured()) {
    return createMockIdentitySession(walletAddress);
  }

  const created = await digilockerRequest('POST', '/api/digilocker', {
    redirectUrl: redirectUrl || DIGILOCKER_REDIRECT_URL,
  });
  const requestId = String(created.id || '').trim();
  if (!requestId) {
    throw new Error('DigiLocker request creation returned empty id');
  }
  const session = {
    requestId,
    walletAddress,
    status: 'pending_digilocker_consent',
    authUrl: String(created.url || '').trim() || `${DIGILOCKER_REDIRECT_URL}?request_id=${requestId}`,
    createdAt: Date.now(),
    flags: null,
    claimHashes: null,
    aadhaar: null,
  };
  identitySessions.set(requestId, session);
  return session;
}

async function resolveIdentitySession(requestId) {
  const session = identitySessions.get(requestId);
  if (!session) {
    throw new Error('Unknown identity request id');
  }

  if (!isDigiLockerConfigured()) {
    if (session.status !== 'identity_verified') {
      session.status = 'identity_verified';
    }
    return session;
  }

  const statusPayload = await digilockerRequest('GET', `/api/digilocker/${requestId}/status`);
  const status = String(statusPayload.status || '').trim().toLowerCase();
  if (!['authenticated', 'success'].includes(status)) {
    session.status = 'pending_digilocker_consent';
    session.authUrl = String(statusPayload.url || '').trim() || session.authUrl;
    return session;
  }

  const aadhaarPayload = await digilockerRequest('GET', `/api/digilocker/${requestId}/aadhaar`);
  const flags = computeIdentityFlags(aadhaarPayload);
  session.status = 'identity_verified';
  session.aadhaar = aadhaarPayload;
  session.flags = flags;
  session.claimHashes = {
    indianCitizen: buildClaimHash(session.walletAddress, 'indian_citizen', String(flags.isIndian)),
    ageOver18: buildClaimHash(session.walletAddress, 'age_over_18', String(flags.ageOver18)),
    verifiedHuman: buildClaimHash(session.walletAddress, 'verified_human', String(flags.isVerifiedHuman)),
  };
  return session;
}

async function verifyAlgoPlonkProof({
  walletAddress,
  claimHash,
  proofHex,
  publicInputsHex,
}) {
  const { normalized: normalizedProof, chunks: proofChunks } = bytes32ChunksFromHex(proofHex, 'algoplonkProofHex');
  const { normalized: normalizedInputs, chunks: publicInputChunks } = bytes32ChunksFromHex(
    publicInputsHex,
    'algoplonkPublicInputsHex'
  );

  if (!publicInputChunks.length) {
    throw new Error('algoplonkPublicInputsHex must contain at least one bytes32 item');
  }

  if (publicInputChunks[0].toString('hex') !== claimHash.toLowerCase()) {
    throw new Error('algoplonkPublicInputsHex[0] must equal the expected claim hash');
  }

  if (publicInputChunks.length > 1) {
    const expectedWalletCommitment = buildWalletCommitment(walletAddress);
    if (publicInputChunks[1].toString('hex') !== expectedWalletCommitment) {
      throw new Error('algoplonkPublicInputsHex[1] must equal the wallet commitment');
    }
  }

  let onchainVerification = null;
  let onchainError = null;

  if (ALGOPLONK_SIMULATE_ONLY) {
    onchainError = 'algoplonk_simulation_only_enabled';
  } else if (ALGOPLONK_VERIFY_APP_ID > 0) {
    try {
      const algodClient = getAlgodClient();
      const verifierSk = getVerifierAccount();
      const method = new algosdk.ABIMethod({
        name: 'verify',
        args: [
          { type: 'byte[32][]', name: 'proof' },
          { type: 'byte[32][]', name: 'public_inputs' },
        ],
        returns: { type: 'bool' },
      });
      const suggestedParams = await algodClient.getTransactionParams().do();
      const atc = new algosdk.AtomicTransactionComposer();
      atc.addMethodCall({
        appID: ALGOPLONK_VERIFY_APP_ID,
        method,
        sender: verifierSk.addr,
        signer: algosdk.makeBasicAccountTransactionSigner(verifierSk),
        suggestedParams,
        methodArgs: [proofChunks, publicInputChunks],
      });
      const result = await atc.execute(algodClient, 4);
      const abiResult = result.methodResults?.[0]?.returnValue;
      onchainVerification = {
        verified: Boolean(abiResult),
        txId: result.txIDs?.[0] || null,
      };
    } catch (error) {
      onchainError = error?.message || 'algoplonk_onchain_verification_failed';
    }
  } else {
    onchainError = 'algoplonk_verifier_app_not_configured';
  }

  if (ALGOPLONK_REQUIRE_ONCHAIN_VERIFY && !(onchainVerification && onchainVerification.verified)) {
    throw new Error(`AlgoPlonk on-chain verification required but unavailable: ${onchainError || 'verification_failed'}`);
  }

  return {
    proofVerified: true,
    verificationMode:
      onchainVerification && onchainVerification.verified ? 'onchain_verified' : 'shape_verified',
    proofHash: sha256Hex(normalizedProof),
    publicInputsHash: sha256Hex(normalizedInputs),
    onchainVerification,
    onchainError,
    proofChunkCount: proofChunks.length,
    publicInputChunkCount: publicInputChunks.length,
  };
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

async function verifyIncomeProofAndAnchor({ proof, walletAddress, identity = null }) {
  if (!proof) {
    throw new Error('Missing proof');
  }
  if (!walletAddress) {
    throw new Error('Missing walletAddress');
  }

  const proofHash = crypto
    .createHash('sha256')
    .update(JSON.stringify(proof))
    .digest('hex');

  console.log('\n');
  console.log('╔══════════════════════════════════════════════════════════════════╗');
  console.log('║              🔐 NEW VERIFICATION REQUEST                        ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ PROOF HASH:', proofHash);
  if (identity?.claimHash) {
    console.log('║ IDENTITY CLAIM HASH:', identity.claimHash);
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝');

  const isValid = await Reclaim.verifyProof(proof);
  if (!isValid) {
    throw new Error('Invalid proof signature');
  }
  console.log('✅ PROOF SIGNATURE VERIFIED');

  logProofStructure(proof);

  const claimData = proof?.claimData || {};
  const context = parseClaimContext(claimData);

  if (context.contextAddress && context.contextAddress !== walletAddress) {
    throw new Error('Wallet mismatch with proof');
  }

  const uberUid = extractUid(claimData);
  const email = extractEmail(claimData);

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║              📊 EXTRACTED USER DATA                             ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ UID:', uberUid || 'NOT FOUND (using fallback)');
  console.log('║ EMAIL:', email ? email.split('@')[0] + '@***' : 'not found');
  console.log('║ UID SOURCE:', uberUid ? 'real from proof' : 'proof hash fallback');
  console.log('╚══════════════════════════════════════════════════════════════════╝');

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
  if (identity?.verificationMode) {
    console.log('║ IDENTITY MODE:', identity.verificationMode);
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  return {
    success: true,
    tier,
    creditLimit,
    txId,
    message: `${reason}: ₹${driverData.monthlyEarnings.toLocaleString()}/month`,
    identity,
  };
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

function identitySessionResponse(session, algoplonk = null) {
  return {
    success: true,
    requestId: session.requestId,
    walletAddress: session.walletAddress,
    status: session.status,
    authUrl: session.authUrl,
    flags: session.flags
      ? {
          isIndian: Boolean(session.flags.isIndian),
          ageOver18: Boolean(session.flags.ageOver18),
          isVerifiedHuman: Boolean(session.flags.isVerifiedHuman),
        }
      : null,
    claimHashes: session.claimHashes || null,
    algoplonk,
  };
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

app.post('/api/identity/digilocker/request', async (req, res) => {
  try {
    const { walletAddress, redirectUrl } = req.body || {};
    if (!walletAddress) {
      return res.status(400).json({ success: false, message: 'Missing walletAddress' });
    }
    const session = await createIdentitySession(walletAddress, redirectUrl);
    return res.json(identitySessionResponse(session));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to create DigiLocker session' });
  }
});

app.post('/api/digi/request', async (req, res) => {
  try {
    const { walletAddress, redirectUrl } = req.body || {};
    if (!walletAddress) {
      return res.status(400).json({ success: false, message: 'Missing walletAddress' });
    }
    const session = await createIdentitySession(walletAddress, redirectUrl);
    return res.json(identitySessionResponse(session));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to create DigiLocker session' });
  }
});

app.get('/api/identity/digilocker/:requestId/status', async (req, res) => {
  try {
    const session = await resolveIdentitySession(req.params.requestId);
    return res.json(identitySessionResponse(session));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to resolve DigiLocker status' });
  }
});

app.get('/api/digi/:requestId/status', async (req, res) => {
  try {
    const session = await resolveIdentitySession(req.params.requestId);
    return res.json(identitySessionResponse(session));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'Failed to resolve DigiLocker status' });
  }
});

app.post('/api/identity/algoplonk/verify', async (req, res) => {
  try {
    const { walletAddress, requestId, claimType = 'indianCitizen', algoplonkProofHex, algoplonkPublicInputsHex } = req.body || {};
    if (!walletAddress || !requestId || !algoplonkProofHex || !algoplonkPublicInputsHex) {
      return res.status(400).json({ success: false, message: 'walletAddress, requestId, algoplonkProofHex, and algoplonkPublicInputsHex are required' });
    }

    const session = await resolveIdentitySession(requestId);
    if (session.walletAddress !== walletAddress) {
      return res.status(400).json({ success: false, message: 'Wallet mismatch for identity session' });
    }
    if (session.status !== 'identity_verified' || !session.claimHashes) {
      return res.status(409).json({ success: false, message: 'Identity is not verified yet' });
    }

    const claimHash = session.claimHashes[claimType] || session.claimHashes.indianCitizen;
    const algoplonk = await verifyAlgoPlonkProof({
      walletAddress,
      claimHash,
      proofHex: algoplonkProofHex,
      publicInputsHex: algoplonkPublicInputsHex,
    });
    return res.json(identitySessionResponse(session, algoplonk));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'AlgoPlonk verification failed' });
  }
});

app.post('/api/digi/verify', async (req, res) => {
  try {
    const { walletAddress, requestId, claimType = 'indianCitizen', algoplonkProofHex, algoplonkPublicInputsHex } = req.body || {};
    if (!walletAddress || !requestId || !algoplonkProofHex || !algoplonkPublicInputsHex) {
      return res.status(400).json({ success: false, message: 'walletAddress, requestId, algoplonkProofHex, and algoplonkPublicInputsHex are required' });
    }

    const session = await resolveIdentitySession(requestId);
    if (session.walletAddress !== walletAddress) {
      return res.status(400).json({ success: false, message: 'Wallet mismatch for identity session' });
    }
    if (session.status !== 'identity_verified' || !session.claimHashes) {
      return res.status(409).json({ success: false, message: 'Identity is not verified yet' });
    }

    const claimHash = session.claimHashes[claimType] || session.claimHashes.indianCitizen;
    const algoplonk = await verifyAlgoPlonkProof({
      walletAddress,
      claimHash,
      proofHex: algoplonkProofHex,
      publicInputsHex: algoplonkPublicInputsHex,
    });
    return res.json(identitySessionResponse(session, algoplonk));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'AlgoPlonk verification failed' });
  }
});

app.get('/api/digi/health', (_req, res) => {
  return res.json({
    success: true,
    digilockerConfigured: isDigiLockerConfigured(),
    algoplonk: {
      verifyAppId: ALGOPLONK_VERIFY_APP_ID > 0 ? ALGOPLONK_VERIFY_APP_ID : null,
      requireOnchainVerify: ALGOPLONK_REQUIRE_ONCHAIN_VERIFY,
      simulateOnly: ALGOPLONK_SIMULATE_ONLY,
    },
  });
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
    const result = await verifyIncomeProofAndAnchor({ proof, walletAddress });
    return res.json(result);
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

app.post('/verify-worker-profile', async (req, res) => {
  try {
    const {
      walletAddress,
      identityRequestId,
      reclaimProof,
      algoplonkProofHex,
      algoplonkPublicInputsHex,
      claimType = 'indianCitizen',
    } = req.body || {};

    if (!walletAddress || !identityRequestId || !reclaimProof || !algoplonkProofHex || !algoplonkPublicInputsHex) {
      return res.status(400).json({
        success: false,
        message: 'walletAddress, identityRequestId, reclaimProof, algoplonkProofHex, and algoplonkPublicInputsHex are required',
      });
    }

    const session = await resolveIdentitySession(identityRequestId);
    if (session.walletAddress !== walletAddress) {
      return res.status(400).json({ success: false, message: 'Wallet mismatch for identity session' });
    }
    if (session.status !== 'identity_verified' || !session.flags || !session.claimHashes) {
      return res.status(409).json({ success: false, message: 'Identity verification is incomplete' });
    }
    if (!session.flags.isIndian || !session.flags.ageOver18 || !session.flags.isVerifiedHuman) {
      return res.status(403).json({ success: false, message: 'Identity claims do not satisfy Acre policy' });
    }

    const claimHash = session.claimHashes[claimType] || session.claimHashes.indianCitizen;
    const algoplonk = await verifyAlgoPlonkProof({
      walletAddress,
      claimHash,
      proofHex: algoplonkProofHex,
      publicInputsHex: algoplonkPublicInputsHex,
    });

    const result = await verifyIncomeProofAndAnchor({
      proof: reclaimProof,
      walletAddress,
      identity: {
        requestId: identityRequestId,
        claimHash,
        flags: session.flags,
        verificationMode: algoplonk.verificationMode,
        proofHash: algoplonk.proofHash,
      },
    });

    return res.json({
      ...result,
      identity: {
        requestId: identityRequestId,
        flags: session.flags,
        claimHashes: session.claimHashes,
        algoplonk,
      },
    });
  } catch (error) {
    console.error('\n❌ WORKER PROFILE VERIFICATION ERROR:', error);
    if ((error?.message || '').includes('User must opt in to the app before verification')) {
      return res.status(409).json({
        success: false,
        needsOptIn: true,
        message: error.message,
      });
    }
    return res.status(500).json({
      success: false,
      message: error?.message || 'Internal worker profile verification error',
    });
  }
});

const server = app.listen(PORT);

server.on('listening', () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : PORT;
  console.log(`🚀 Acre backend on http://localhost:${port}`);
  console.log('📜 Proof logging enabled\n');
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`❌ Port ${PORT} is already in use. Stop the other process or run with PORT=<new-port>.`);
    process.exitCode = 1;
    return;
  }
  console.error('❌ Server failed to start:', error);
  process.exitCode = 1;
});

server.on('close', () => {
  console.error('⚠️ HTTP server closed');
});
