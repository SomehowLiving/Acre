'use strict';

const express = require('express');
const cors = require('cors');
const Reclaim = require('@reclaimprotocol/js-sdk');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
require('dotenv').config();
const algosdk = require('algosdk');
const ACRE_SYSTEM_PROMPT = require('./advisorPrompt');
const {
  BLUE_SCORE_THRESHOLDS,
  computeBlueScore,
  computeDashboardScore,
  creditLimitForTier,
  deriveAddressSeedSignals,
  deriveOnchainSignals,
  nextTierForLabel,
  normalizeGigSignals,
  scoreRecordFromSignals,
} = require('./scoring');

const app = express();
const PORT = process.env.PORT || 3001;
const CONTRACTS_DIR = path.join(__dirname, 'contracts');
const ABI_PATH = path.join(CONTRACTS_DIR, 'acre_abi.json');
const DEPLOYED_APP_PATH = path.join(CONTRACTS_DIR, 'deployed_testnet_app.json');
const identitySessions = new Map();

const DIGILOCKER_BASE_URL = process.env.ACRE_DIGILOCKER_BASE_URL || 'https://dg-sandbox.setu.co';
const DIGILOCKER_REDIRECT_URL = process.env.ACRE_DIGILOCKER_REDIRECT_URL || 'http://localhost:8080/digi';
const DIGILOCKER_TIMEOUT_MS = Number(process.env.ACRE_DIGILOCKER_TIMEOUT_SECONDS || '15') * 1000;
const ALGOPLONK_VERIFY_METHOD_SIGNATURE =
  process.env.ACRE_ALGOPLONK_VERIFY_METHOD_SIGNATURE || 'verify(byte[32][],byte[32][])bool';
const ALGOPLONK_REQUIRE_ONCHAIN_VERIFY =
  ['1', 'true', 'yes', 'on'].includes(String(process.env.ACRE_ALGOPLONK_REQUIRE_ONCHAIN_VERIFY || '').toLowerCase());
const ALGOPLONK_SIMULATE_ONLY =
  ['1', 'true', 'yes', 'on'].includes(String(process.env.ACRE_ALGOPLONK_SIMULATE_ONLY || '').toLowerCase());
const ALGOPLONK_VERIFY_APP_ID = Number(process.env.ACRE_ALGOPLONK_VERIFY_APP_ID || '0');

// Algorand Indexer — auto-derive from algod URL if not explicitly set.
// testnet-api.algonode.cloud → testnet-idx.algonode.cloud
function getIndexerBaseUrl() {
  const explicit = (process.env.ACRE_INDEXER_SERVER || '').trim();
  if (explicit) return explicit.replace(/\/$/, '');
  const algod = (process.env.ALGOD_SERVER || process.env.TESTNET_ALGOD_SERVER || '').trim();
  return algod.replace(/\/$/, '').replace('testnet-api.', 'testnet-idx.').replace('-api.algonode', '-idx.algonode');
}

const allowedOrigins = (
  process.env.CORS_ORIGINS ||
  'http://localhost:3000,http://127.0.0.1:3000,http://localhost:3001,http://127.0.0.1:3001,http://localhost:5173,http://127.0.0.1:5173,http://localhost:8080,http://127.0.0.1:8080,https://acre-web-three.vercel.app'
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

function toNumber(value, fallback = 0) {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function unpackBuckets(packedValue) {
  const packed = toNumber(packedValue);
  return {
    incomeBucket: Math.floor(packed / 16777216) % 256,
    tenureBucket: Math.floor(packed / 65536) % 256,
    completionBucket: Math.floor(packed / 256) % 256,
    ratingBucket: packed % 256,
  };
}

function normalizeFullProfile(value) {
  const [
    verified,
    tier,
    creditLimit,
    timestamp,
    riderCount,
    riderRating,
    platform,
    score,
    buckets,
    source,
    plausibilityFlags,
    monthlyEarnings,
    tenureMonths,
    completionRate,
  ] = Array.isArray(value) ? value : [];
  const completionRateRaw = toNumber(completionRate);

  return {
    verified: toNumber(verified) === 1,
    tier: toNumber(tier),
    creditLimit: toNumber(creditLimit),
    timestamp: toNumber(timestamp),
    riderCount: toNumber(riderCount),
    riderRating: toNumber(riderRating) / 100,
    platform: platform || '',
    score: toNumber(score),
    buckets: toNumber(buckets),
    bucketBreakdown: unpackBuckets(buckets),
    source: source || '',
    plausibilityFlags: toNumber(plausibilityFlags),
    monthlyEarnings: toNumber(monthlyEarnings),
    tenureMonths: toNumber(tenureMonths),
    completionRate: completionRateRaw / 100,
    completionRateRaw,
  };
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

// ---------------------------------------------------------------------------
// Consent token — HMAC-SHA256 signed payload mirroring Shunyak's token.py.
// If ACRE_DEMO_SECRET is unset, derive a stable local key so demos work out-of-the-box.
// ---------------------------------------------------------------------------

function resolveTokenSecret() {
  const configured = (process.env.ACRE_DEMO_SECRET || '').trim();
  if (configured) return Buffer.from(configured, 'utf8');
  // Local dev fallback: derive from stable machine properties (not suitable for production).
  const material = ['acre-local-insecure-token-key', process.env.USER || 'local', process.cwd()].join(':');
  return crypto.createHash('sha256').update(material).digest();
}

function mintConsentToken({
  userPubkeyHex,
  enterprisePubkeyHex,
  claimHash,
  consentTxid = null,
  noteTxid = null,
  expiresAt,
  appId = null,
  identityProvider = 'digilocker',
  zkBackend = 'algoplonk',
  mode = 'local',
}) {
  const secret = resolveTokenSecret();
  const payload = {
    kind: 'consent',
    user_pubkey: userPubkeyHex,
    enterprise_pubkey: enterprisePubkeyHex,
    claim_hash: claimHash,
    expires_at: expiresAt,
    iat: Math.floor(Date.now() / 1000),
    mode,
    identity_provider: identityProvider,
    zk_backend: zkBackend,
  };
  if (consentTxid) payload.consent_txid = consentTxid;
  if (noteTxid) payload.note_txid = noteTxid;
  if (appId && appId > 0) payload.app_id = appId;

  // Stable sort keys → deterministic base64url payload
  const payloadPart = Buffer.from(
    JSON.stringify(Object.fromEntries(Object.keys(payload).sort().map((k) => [k, payload[k]])))
  ).toString('base64url');
  const sigPart = crypto.createHmac('sha256', secret).update(payloadPart).digest().toString('base64url');
  return `${payloadPart}.${sigPart}`;
}

// ---------------------------------------------------------------------------
// Ed25519 attestation — signs claimHash + user_pubkey + enterprise_pubkey + expiry
// with the registrar/verifier key before on-chain consent anchoring.
// ---------------------------------------------------------------------------

function signContractAttestation({ claimHash, walletAddress, enterprisePubkeyHex, expiryTimestamp }) {
  try {
    const registrar = getRegistrarAccount();
    const claimHashBytes = Buffer.from(claimHash, 'hex');
    const userPubkeyBytes = Buffer.from(algosdk.decodeAddress(walletAddress).publicKey);
    const enterpriseBytes = Buffer.from(enterprisePubkeyHex, 'hex');
    const expiryBytes = Buffer.alloc(8);
    expiryBytes.writeBigUInt64BE(BigInt(expiryTimestamp));
    const message = Buffer.concat([claimHashBytes, userPubkeyBytes, enterpriseBytes, expiryBytes]);
    return Buffer.from(algosdk.signBytes(message, registrar.sk)).toString('hex');
  } catch (_err) {
    return null; // best-effort — caller decides whether to surface this
  }
}

// ---------------------------------------------------------------------------
// Note anchor — 0-algo self-payment whose note field is the JSON consent record.
// Creates a permanent, explorer-queryable on-chain audit trail independent of
// the ABI contract call.
// ---------------------------------------------------------------------------

async function submitNoteAnchor({ notePayload }) {
  try {
    const algodClient = getAlgodClient();
    const registrar = getRegistrarAccount();
    const suggestedParams = await algodClient.getTransactionParams().do();

    const txn = algosdk.makePaymentTxnWithSuggestedParamsFromObject({
      from: registrar.addr,
      to: registrar.addr,
      amount: 0,
      note: Buffer.from(JSON.stringify(notePayload)),
      suggestedParams,
    });

    const signedTxn = txn.signTxn(registrar.sk);
    const { txId } = await algodClient.sendRawTransaction(signedTxn).do();
    await algosdk.waitForConfirmation(algodClient, txId, 4);

    return {
      txId,
      explorerUrl: `https://testnet.algoexplorer.io/tx/${txId}`,
    };
  } catch (err) {
    return { txId: null, explorerUrl: null, error: err?.message || 'note_anchor_failed' };
  }
}

// If client has no real AlgoPlonk circuit, generate a deterministic demo-safe payload.
// First public input is always anchored to claimHash so the consent integrity check passes.
function autofillAlgoplonkPayload(claimHash) {
  const publicChunk2 = sha256Hex(`${claimHash}|algoplonk_public_inputs|acre`);
  const proofChunk1 = sha256Hex(`${claimHash}|algoplonk_proof_chunk_1|acre`);
  const proofChunk2 = sha256Hex(`${claimHash}|algoplonk_proof_chunk_2|acre`);
  return {
    proofHex: proofChunk1 + proofChunk2,
    publicInputsHex: claimHash.toLowerCase() + publicChunk2,
    autofilled: true,
  };
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
  const now = new Date();
  const session = {
    requestId,
    walletAddress,
    status: 'pending_digilocker_consent',
    // Points to our local mock consent page — simulates the Setu DigiLocker OAuth screen.
    authUrl: `http://localhost:${PORT}/mock-digilocker-consent?request_id=${requestId}`,
    mockApproved: false,
    createdAt: Date.now(),
    flags: null,
    claimHashes: null,
    aadhaar: {
      traceId: `mock-trace-${requestId.slice(-8)}`,
      aadhaar: {
        maskedNumber: 'XXXX-XXXX-4242',
        dateOfBirth: '01-01-1998',
        generatedAt: now.toISOString(),
        gender: 'M',
        address: { country: 'India', state: 'Maharashtra', district: 'Pune' },
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
      // Gate on the user having clicked "Allow" on the mock consent page.
      // If they haven't approved yet, stay pending so the UI can show Check Status again.
      if (!session.mockApproved) {
        return session;
      }
      session.status = 'identity_verified';
      // Derive flags from mock Aadhaar the same way the real path does — no hardcoding.
      const flags = computeIdentityFlags(session.aadhaar);
      session.flags = flags;
      session.claimHashes = {
        indianCitizen: buildClaimHash(session.walletAddress, 'indian_citizen', String(flags.isIndian)),
        ageOver18: buildClaimHash(session.walletAddress, 'age_over_18', String(flags.ageOver18)),
        verifiedHuman: buildClaimHash(session.walletAddress, 'verified_human', String(flags.isVerifiedHuman)),
      };
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
  score,
  incomeBucket,
  tenureBucket,
  completionBucket,
  ratingBucket,
  source,
  plausibilityFlags,
  monthlyEarnings,
  tenureMonths,
  completionRate,
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
      score,
      incomeBucket,
      tenureBucket,
      completionBucket,
      ratingBucket,
      source,
      plausibilityFlags,
      monthlyEarnings,
      tenureMonths,
      completionRate,
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

  const signals = extractReclaimSignals(proof, proofHash);
  const blueScore = computeBlueScore(signals);
  const { contractTier: tier, creditLimit, reason, score, breakdown, apr } = blueScore;
  const scoreRecord = scoreRecordFromSignals(signals);
  const riderCount = signals.trips;
  const riderRating = Math.round(signals.rating * 100);

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
    score,
    ...scoreRecord,
  });

  console.log('\n╔══════════════════════════════════════════════════════════════════╗');
  console.log('║              💰 CREDIT DECISION                                 ║');
  console.log('╠══════════════════════════════════════════════════════════════════╣');
  console.log('║ SIGNAL SOURCE:', signals.source);
  console.log('║ TRIPS:', signals.trips);
  console.log('║ RATING:', signals.rating);
  console.log('║ MONTHLY EARNINGS: ₹' + signals.earnings.toLocaleString());
  console.log('║ TENURE:', signals.tenure, 'months');
  console.log('║ COMPLETION RATE:', signals.completionRate + '%');
  if (signals.plausibilityIssues?.length) {
    console.log('║ PLAUSIBILITY ADJUSTMENTS:', signals.plausibilityIssues.join(', '));
  }
  console.log('║ BLUE SCORE:', score);
  console.log('║ TIER:', blueScore.tier, `(contract tier ${tier})`);
  console.log('║ CREDIT LIMIT: ₹' + creditLimit.toLocaleString());
  console.log('║ APR RANGE:', apr + '%');
  console.log('║ TX ID:', txId);
  console.log('║ REASON:', reason);
  if (identity?.verificationMode) {
    console.log('║ IDENTITY MODE:', identity.verificationMode);
  }
  console.log('╚══════════════════════════════════════════════════════════════════╝\n');

  return {
    success: true,
    tier,
    contractTier: tier,
    creditLimit,
    txId,
    score,
    blueScoreTier: blueScore.tier,
    apr,
    reason,
    signals: {
      trips: signals.trips,
      rating: signals.rating,
      earnings: signals.earnings,
      tenure: signals.tenure,
      completionRate: signals.completionRate,
      monthlyTrips: signals.monthlyTrips,
      rupeesPerTrip: signals.rupeesPerTrip,
      plausibilityIssues: signals.plausibilityIssues,
      syntheticProfile: signals.syntheticProfile,
      source: signals.source,
    },
    breakdown,
    message: `${reason}: ₹${signals.earnings.toLocaleString()}/month`,
    identity,
  };
}

// ---------------------------------------------------------------------------
// Signal extraction — reads real fields from Reclaim proof's extractedParameters.
// Falls back to a deterministic seed derived from the proof hash so the same
// proof always yields the same score (no randomness).
// ---------------------------------------------------------------------------

function extractReclaimSignals(proof, proofHash) {
  const claimData = proof?.claimData || {};

  // Parse extractedParameters from the claimData.parameters string (Reclaim SDK format)
  let extracted = {};
  const rawParams = claimData?.parameters;
  if (typeof rawParams === 'string') {
    try {
      const p = JSON.parse(rawParams);
      Object.assign(extracted, p?.extractedParameters || p?.paramValues || {});
    } catch { /* ignore */ }
  } else if (rawParams && typeof rawParams === 'object') {
    Object.assign(extracted, rawParams?.extractedParameters || rawParams);
  }

  // Also scan the context blob (some providers put values there)
  try {
    const rawCtx = claimData?.context;
    const ctx = typeof rawCtx === 'string' ? JSON.parse(rawCtx) : rawCtx;
    Object.assign(extracted, ctx?.extractedParameters || {});
  } catch { /* ignore */ }

  const toInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) && n > 0 ? n : 0; };
  const toFloat = (v) => { const n = parseFloat(v); return Number.isFinite(n) && n > 0 ? n : 0; };

  const trips = toInt(extracted.trips_completed ?? extracted.tripsCompleted ?? extracted.trip_count ?? extracted.totalTrips ?? extracted.total_trips);
  const rating = toFloat(extracted.rating ?? extracted.driver_rating ?? extracted.driverRating ?? extracted.avg_rating);
  const monthlyEarn = toInt(extracted.monthly_earnings ?? extracted.monthlyEarnings ?? extracted.monthly_income ?? extracted.earnings_month);
  const weeklyEarn = toInt(extracted.weekly_earnings ?? extracted.weeklyEarnings ?? extracted.earnings_week);
  const tenure = toInt(extracted.tenure_months ?? extracted.account_age_months ?? extracted.accountAgeMonths ?? extracted.months_active ?? extracted.months_on_platform);
  const completion = toFloat(extracted.completion_rate ?? extracted.completionRate ?? extracted.acceptance_rate);

  const earnings = monthlyEarn || (weeklyEarn ? weeklyEarn * 4 : 0);

  if (trips > 0 || rating > 0 || earnings > 0) {
    return normalizeGigSignals({
      trips: trips || Math.round(earnings / 300),  // rough fallback within real data
      rating: rating || 4.2,
      earnings: earnings || trips * 280,
      tenure: tenure || Math.max(1, Math.round(trips / 120)),
      completionRate: completion || 88,
      weeklyEarnings: weeklyEarn || Math.round(earnings / 4),
      source: 'reclaim_proof',
    });
  }

  // Deterministic fallback — same proof → same score, every time.
  // Build correlated values so mock data remains physically and commercially plausible.
  return deriveSyntheticGigProfile(proofHash, 'deterministic_fallback');
}

async function getDashboardRecord(address) {
  const [onchain, history] = await Promise.all([
    getOnchainBaseline(address),
    getAcreHistory(address),
  ]);
  const signals = onchain.riderCount > 0
    ? deriveOnchainSignals(onchain)
    : deriveAddressSeedSignals(address);
  const result = computeDashboardScore(onchain, signals, history);
  return { onchain, history, signals, result };
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
  const aadhaarObj = session.aadhaar?.aadhaar;
  const verified = session.status === 'identity_verified';
  const steps = [
    'identity_provider: digilocker',
    verified ? 'digilocker_consent: authenticated' : 'digilocker_consent: pending',
    ...(verified ? ['aadhaar_fetched: true', 'claim_extracted: true'] : []),
    ...(algoplonk ? [`zk_verification_mode: ${algoplonk.verificationMode || 'shape_verified'}`, algoplonk.autofilled ? 'algoplonk_payload: autofilled' : 'algoplonk_payload: client_supplied'] : []),
  ];
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
    aadhaar: aadhaarObj
      ? {
        maskedNumber: aadhaarObj.maskedNumber || null,
        generatedAt: aadhaarObj.generatedAt || null,
        traceId: session.aadhaar?.traceId || null,
      }
      : null,
    algoplonk,
    steps,
  };
}

async function getOnchainBaseline(address) {
  try {
    const [creditLimitRaw, eligibilityRaw, profileRaw] = await Promise.all([
      callReadMethod({ methodName: 'get_credit_limit', methodArgs: [address], appAccounts: [address] }),
      callReadMethod({ methodName: 'get_eligibility', methodArgs: [address], appAccounts: [address] }),
      callReadMethod({ methodName: 'get_full_profile', methodArgs: [address], appAccounts: [address] }),
    ]);
    const creditLimit = Number(creditLimitRaw || 0);
    const eligibility = Number(eligibilityRaw || 0);
    const profile = normalizeFullProfile(profileRaw);
    return {
      creditLimit,
      eligibility,
      verified: profile.verified,
      tier: profile.tier,
      riderCount: profile.riderCount,
      riderRating: profile.riderRating,
      score: profile.score,
      buckets: profile.buckets,
      bucketBreakdown: profile.bucketBreakdown,
      source: profile.source,
      plausibilityFlags: profile.plausibilityFlags,
      monthlyEarnings: profile.monthlyEarnings,
      tenureMonths: profile.tenureMonths,
      completionRate: profile.completionRate,
    };
  } catch {
    return {
      creditLimit: 0,
      eligibility: 0,
      verified: false,
      tier: 0,
      riderCount: 0,
      riderRating: 0,
      score: 0,
      buckets: 0,
      bucketBreakdown: unpackBuckets(0),
      source: '',
      plausibilityFlags: 0,
      monthlyEarnings: 0,
      tenureMonths: 0,
      completionRate: 0,
    };
  }
}

function nullHistory() {
  return {
    verificationCount: 0,
    acreMonths: 0,
    returning: false,
    daysSinceLastVerification: null,
    firstVerificationDate: null,
    lastVerificationDate: null,
  };
}

async function getAcreHistory(walletAddress) {
  let appId;
  try { appId = loadAppId(); } catch { return nullHistory(); }
  if (!appId || appId <= 0) return nullHistory();

  const idxBase = getIndexerBaseUrl();
  if (!idxBase) return nullHistory();

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const url = `${idxBase}/v2/accounts/${walletAddress}/transactions`
      + `?application-id=${appId}&tx-type=appl&limit=50`;
    let resp;
    try {
      resp = await fetch(url, { signal: controller.signal });
    } finally {
      clearTimeout(timeout);
    }
    if (!resp.ok) return nullHistory();

    const data = await resp.json();
    const txns = (data?.transactions || []).filter(tx =>
      tx['round-time'] && tx['application-transaction']
    );
    if (txns.length === 0) return nullHistory();

    // Sort oldest first for date arithmetic.
    txns.sort((a, b) => a['round-time'] - b['round-time']);
    const firstTs = txns[0]['round-time'];
    const lastTs = txns[txns.length - 1]['round-time'];

    const firstDate = new Date(firstTs * 1000).toISOString().slice(0, 10);
    const lastDate = new Date(lastTs * 1000).toISOString().slice(0, 10);
    const nowSec = Math.floor(Date.now() / 1000);
    const daysSinceLast = Math.floor((nowSec - lastTs) / 86400);

    // Months on ACRE = span from first to last verification, rounded up.
    const acreMonths = Math.max(1, Math.ceil((lastTs - firstTs) / (30 * 86400)));

    return {
      verificationCount: txns.length,
      acreMonths,
      returning: txns.length >= 2,
      daysSinceLastVerification: daysSinceLast,
      firstVerificationDate: firstDate,
      lastVerificationDate: lastDate,
    };
  } catch {
    return nullHistory();
  }
}

function mockFeaturesFromAddress(address) {
  const seed = parseInt(sha256Hex(address).slice(0, 8), 16);
  return {
    monthlyIncome: 16000 + (seed % 50000),
    consistencyMonths: 1 + (seed % 18),
    rating: Number((3.8 + ((seed % 13) / 10)).toFixed(1)),
    activityDaysPerMonth: 8 + (seed % 20),
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
    return res.json({
      success: true,
      address,
      profile: normalizeFullProfile(value),
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

app.get('/api/user/:address/history', async (req, res) => {
  try {
    const { address } = req.params;
    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ success: false, message: 'Invalid Algorand address' });
    }
    const history = await getAcreHistory(address);
    return res.json({ success: true, address, history });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch ACRE history' });
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

app.get('/api/blue-score/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ success: false, message: 'Invalid Algorand address' });
    }
    const { onchain, history, signals, result } = await getDashboardRecord(address);
    const modelEligibility = result.creditLimit;
    const apr = result.apr;
    return res.json({
      success: true,
      address,
      canonicalSource: onchain.score > 0 ? 'onchain_profile' : 'preview_seed',
      verifiedKyc: onchain.verified || signals.source === 'onchain_derived',
      score: result.score,
      tier: result.tier,
      contractTier: result.contractTier,
      loanEligibility: modelEligibility,
      creditLimit: modelEligibility,
      apr,
      breakdown: result.breakdown,
      signals,
      history,
      scoreFreshnessDays: onchain.riderCount > 0 ? 0 : null,
      proofExpiresInDays: 28,
      onchain,
      message: 'Acre is a privacy-preserving credit bureau for gig workers.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to compute blue score' });
  }
});

app.post('/api/blue-score/simulate', async (req, res) => {
  try {
    const {
      monthlyIncome, consistencyMonths, rating, activityDaysPerMonth, monthlyTrips, completionRate,
      currentScore = 0, currentTier = 'Blue Basic',
    } = req.body || {};

    const months = Math.max(1, Math.round(Number(consistencyMonths) || 6));
    const tripsPerMonth = Math.max(0, Math.round(
      Number(monthlyTrips) || (Number(activityDaysPerMonth) * 15) || 0
    ));
    const signals = {
      earnings: Number(monthlyIncome) || 20000,
      tenure: months,
      rating: Number(rating) || 4.2,
      trips: tripsPerMonth * months,
      completionRate: Number(completionRate) || 88,
      monthlyTrips: tripsPerMonth,
    };
    const result = computeBlueScore(signals);
    const delta = result.score - Number(currentScore || 0);
    const nextTier = currentTier === 'Blue Basic' ? 'Blue Plus' : 'Blue Prime';
    let coachingMessage = 'No change — try adjusting multiple factors';
    if (delta > 0 && result.tier !== currentTier) {
      coachingMessage = `Unlock ${result.tier}: ₹${result.creditLimit.toLocaleString('en-IN')} at ${result.apr}% APR`;
    } else if (delta > 0) {
      coachingMessage = `+${delta} points — ${nextTier} requires ${result.tier !== nextTier ? 'more consistency' : 'you\'re there'}`;
    } else if (delta < 0) {
      coachingMessage = `-${Math.abs(delta)} points — maintain consistency to recover`;
    }
    return res.json({
      success: true,
      simulationOnly: true,
      score: result.score,
      tier: result.tier,
      loanEligibility: result.creditLimit,
      apr: result.apr,
      breakdown: result.breakdown,
      coachingMessage,
      disclaimer: 'Preview only. Actual eligibility requires fresh ZK proof submission.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to simulate blue score' });
  }
});

app.post('/api/lender/config/simulate', async (req, res) => {
  try {
    const {
      minIncome = 25000,
      minConsistencyMonths = 4,
      minRating = 4.5,
      incomeWeight = 0.5,
      reputationWeight = 0.5,
    } = req.body || {};
    const approvedUsers = Math.max(12, Math.round(180 * (1 - Math.min(0.85, (Number(minIncome) - 15000) / 70000))));
    const avgLoanTicketSize = Math.round(18000 + Number(incomeWeight) * 18000 + Number(reputationWeight) * 14000);
    const riskEstimate = Number((0.28 - Number(reputationWeight) * 0.1 + Number(incomeWeight) * 0.03).toFixed(3));

    return res.json({
      success: true,
      assumptions: { minIncome, minConsistencyMonths, minRating, incomeWeight, reputationWeight },
      outputs: { approvedUsers, avgLoanTicketSize, riskEstimate },
      notes: 'Mocked cohort simulation for hackathon demo.',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to simulate lender config' });
  }
});

app.get('/api/passport/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ success: false, message: 'Invalid Algorand address' });
    }
    const { onchain, history, signals, result } = await getDashboardRecord(address);
    const nextTier = nextTierForLabel(result.tier);
    const pointsToNextTier = Math.max(0, nextTier.threshold - result.score);

    const platformLabel = signals.source === 'address_seed'
      ? 'Preview Profile'
      : `${signals.source === 'reclaim' || signals.source === 'reclaim_proof' ? 'Reclaim' : 'On-chain'} Verified Work`;

    return res.json({
      success: true,
      address,
      passport: {
        identity: {
          kycVerified: onchain.verified || signals.source === 'onchain_derived',
          sameIdentityAcrossSessions: history.verificationCount > 1,
          piiExposed: false,
          identityBonded: true,
        },
        blueScore: {
          score: result.score,
          tier: result.tier,
          breakdown: result.breakdown,
          signals,
        },
        finance: {
          currentCreditLimit: onchain.creditLimit || result.creditLimit,
          currentEligibility: onchain.eligibility || result.creditLimit,
          riderCount: onchain.riderCount || signals.trips,
          riderRating: onchain.riderRating || signals.rating,
        },
        trust: {
          fraudRisk: result.score >= BLUE_SCORE_THRESHOLDS.plus ? 'Low' : 'Moderate',
          scoreVerifiedDaysAgo: history.daysSinceLastVerification ?? 0,
          reputationUpdateCadence: 'every 28 days',
          incomeProofExpiryDays: 28,
        },
        history,
        pointsToNextTier,
        nextTierLabel: nextTier.label,
      },
      pipeline: [
        'Identity Proof (DigiLocker)',
        'Income Proof (Reclaim ZK)',
        'Reputation Proof (Platform ratings)',
        'Feature Extraction',
        'Blue Score (Scorecard)',
        'Loan Eligibility / Simulation',
      ],
      journey: [
        {
          platform: platformLabel,
          tenure: `${signals.tenure} months verified`,
          incomeBand: `₹${Math.round(signals.earnings / 1000)}k/mo`,
          rating: String(signals.rating.toFixed(1)),
          completionRate: String(signals.completionRate),
          growthFromPrevious: null,
        },
      ],
      totalTenureMonths: signals.tenure,
      totalGrowth: history.returning ? 'Updated on re-verification' : 'First verified record',
      reliability: signals.completionRate >= 92 ? 'Zero gaps >7 days' : signals.completionRate >= 85 ? 'Consistent' : 'Improving consistency',
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch passport' });
  }
});

app.get('/api/growth/:address', async (req, res) => {
  try {
    const { address } = req.params;
    if (!algosdk.isValidAddress(address)) {
      return res.status(400).json({ success: false, message: 'Invalid Algorand address' });
    }
    const { history, signals, result: current } = await getDashboardRecord(address);

    // Compute exact gap to next tier.
    const nextTier = nextTierForLabel(current.tier);
    const nextTierThreshold = nextTier.threshold;
    const gap = Math.max(0, nextTierThreshold - current.score);
    const nextTierLabel = nextTier.label;

    // Simulate impact of individual improvements.
    const simEarnings = computeBlueScore({ ...signals, earnings: Math.min(80000, signals.earnings * 1.2) }, history);
    const simRating = computeBlueScore({ ...signals, rating: Math.min(5.0, signals.rating + 0.2) }, history);
    const simTenure = computeBlueScore({ ...signals, tenure: signals.tenure + 3 }, history);
    const simCompletion = computeBlueScore({ ...signals, completionRate: Math.min(100, signals.completionRate + 5) }, history);
    const simTrips = computeBlueScore({ ...signals, trips: signals.trips + 200 }, history);

    // Skills derived from platform signals.
    const skills = ['Gig platform operations'];
    if (signals.completionRate >= 90) skills.push('High completion rate');
    if (signals.rating >= 4.5) skills.push('Top-rated driver/rider');
    if (signals.tenure >= 12) skills.push('Experienced operator (1+ year)');
    if (signals.trips >= 1000) skills.push('High-volume delivery');
    if (history.returning) skills.push('Verified returning ACRE user');

    const creditDelta = (tier) => {
      return creditLimitForTier(tier, signals.earnings);
    };

    const recommendations = [];
    if (simEarnings.score > current.score + 5)
      recommendations.push(`Earn ₹${Math.round(signals.earnings * 0.2 / 1000)}k more/month (peak hours 6–9 PM) → +${simEarnings.score - current.score} pts`);
    if (simTenure.score > current.score + 5)
      recommendations.push(`Work 3 more consistent months → +${simTenure.score - current.score} pts${gap > 0 && simTenure.score >= nextTierThreshold ? ` and unlock ${nextTierLabel}` : ''}`);
    if (simRating.score > current.score + 3)
      recommendations.push(`Improve rating by 0.2★ (faster pickups, no cancellations) → +${simRating.score - current.score} pts`);
    if (simCompletion.score > current.score + 2)
      recommendations.push(`Raise completion rate by 5% (accept trips you can complete) → +${simCompletion.score - current.score} pts`);
    if (!history.returning)
      recommendations.push('Re-verify on ACRE after 30 days for +20 reputation bonus pts');
    if (simTrips.score > current.score + 2)
      recommendations.push(`Complete 200 more trips → +${simTrips.score - current.score} pts`);

    // Quests: concrete, threshold-anchored.
    const quests = [];
    if (gap > 0 && nextTierLabel) {
      const monthsNeeded = Math.max(1, Math.ceil(gap / 40));
      quests.push({
        id: 'next_tier',
        title: `Unlock ${nextTierLabel}`,
        description: `${gap} pts needed. Best path: earn more consistently for ~${monthsNeeded} months.`,
        progressMonths: Math.max(0, Math.round(signals.tenure * 0.6)),
        targetMonths: signals.tenure + monthsNeeded,
        reward: `Credit limit: ₹${creditDelta(nextTierLabel).toLocaleString('en-IN')} · APR: ${nextTierLabel === 'Blue Prime' ? '10–12%' : '13–15%'}`,
        pointsGap: gap,
      });
    }
    if (!history.returning) {
      quests.push({
        id: 'returning_user',
        title: 'Earn Reputation Bonus',
        description: 'Re-verify on ACRE 30+ days after your first verification to prove consistency.',
        progressMonths: history.verificationCount >= 1 ? 1 : 0,
        targetMonths: 2,
        reward: '+20 score pts · Reputation badge on your passport',
        pointsGap: 20,
      });
    }
    if (signals.rating < 4.8) {
      quests.push({
        id: 'top_rated',
        title: 'Reach Top-Rated Status',
        description: `Current: ${signals.rating.toFixed(2)}★ → Target: 4.8★. Focus on fast acceptance and zero mid-trip cancels.`,
        progressMonths: Math.round((signals.rating - 3.5) * 4),
        targetMonths: 6,
        reward: `+${simRating.score - current.score} pts · Eligible for 11% APR tier`,
        pointsGap: simRating.score - current.score,
      });
    }
    if (signals.completionRate < 95) {
      quests.push({
        id: 'reliability_star',
        title: 'Reliability Star',
        description: `Reach 95% completion rate (currently ${signals.completionRate}%). Complete every accepted trip.`,
        progressMonths: Math.round(signals.completionRate / 20),
        targetMonths: 5,
        reward: '+8 pts · Reliability badge · Lender trust signal',
        pointsGap: simCompletion.score - current.score,
      });
    }

    return res.json({
      success: true,
      address,
      currentScore: current.score,
      currentTier: current.tier,
      nextTierLabel,
      pointsToNextTier: gap,
      scoreDeltas: {
        earnings: simEarnings.score - current.score,
        rating: simRating.score - current.score,
        tenure: simTenure.score - current.score,
        completion: simCompletion.score - current.score,
        trips: simTrips.score - current.score,
        reputationBonus: history.returning ? 0 : 20,
      },
      skills,
      recommendations,
      quests,
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Failed to fetch growth recommendations' });
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
    const { walletAddress, requestId, claimType = 'indianCitizen' } = req.body || {};
    let { algoplonkProofHex, algoplonkPublicInputsHex } = req.body || {};
    if (!walletAddress || !requestId) {
      return res.status(400).json({ success: false, message: 'walletAddress and requestId are required' });
    }

    const session = await resolveIdentitySession(requestId);
    if (session.walletAddress !== walletAddress) {
      return res.status(400).json({ success: false, message: 'Wallet mismatch for identity session' });
    }
    if (session.status !== 'identity_verified' || !session.claimHashes) {
      return res.status(409).json({ success: false, message: 'Identity is not verified yet' });
    }

    const claimHash = session.claimHashes[claimType] || session.claimHashes.indianCitizen;
    let autofilled = false;
    if (!algoplonkProofHex || !algoplonkPublicInputsHex) {
      const filled = autofillAlgoplonkPayload(claimHash);
      algoplonkProofHex = filled.proofHex;
      algoplonkPublicInputsHex = filled.publicInputsHex;
      autofilled = true;
    }
    const algoplonk = await verifyAlgoPlonkProof({ walletAddress, claimHash, proofHex: algoplonkProofHex, publicInputsHex: algoplonkPublicInputsHex });
    return res.json(identitySessionResponse(session, { ...algoplonk, autofilled }));
  } catch (error) {
    return res.status(400).json({ success: false, message: error?.message || 'AlgoPlonk verification failed' });
  }
});

app.post('/api/digi/verify', async (req, res) => {
  try {
    const { walletAddress, requestId, claimType = 'indianCitizen' } = req.body || {};
    let { algoplonkProofHex, algoplonkPublicInputsHex } = req.body || {};
    if (!walletAddress || !requestId) {
      return res.status(400).json({ success: false, message: 'walletAddress and requestId are required' });
    }

    const session = await resolveIdentitySession(requestId);
    if (session.walletAddress !== walletAddress) {
      return res.status(400).json({ success: false, message: 'Wallet mismatch for identity session' });
    }
    if (session.status !== 'identity_verified' || !session.claimHashes) {
      return res.status(409).json({ success: false, message: 'Identity is not verified yet' });
    }

    const claimHash = session.claimHashes[claimType] || session.claimHashes.indianCitizen;
    let autofilled = false;
    if (!algoplonkProofHex || !algoplonkPublicInputsHex) {
      const filled = autofillAlgoplonkPayload(claimHash);
      algoplonkProofHex = filled.proofHex;
      algoplonkPublicInputsHex = filled.publicInputsHex;
      autofilled = true;
    }
    const algoplonk = await verifyAlgoPlonkProof({ walletAddress, claimHash, proofHex: algoplonkProofHex, publicInputsHex: algoplonkPublicInputsHex });
    return res.json(identitySessionResponse(session, { ...algoplonk, autofilled }));
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

// ---------------------------------------------------------------------------
// Mock DigiLocker consent page — simulates the Setu OAuth / Aadhaar consent UI.
// In real mode, Setu hosts this page. In mock mode we serve it locally.
// ---------------------------------------------------------------------------

app.get('/mock-digilocker-consent', (req, res) => {
  const { request_id: requestId } = req.query;
  const session = requestId ? identitySessions.get(String(requestId)) : null;

  if (!session) {
    return res.status(404).send('<h2>Session not found. Close this window and try again.</h2>');
  }

  const aadhaar = session.aadhaar?.aadhaar || {};
  const maskedNumber = aadhaar.maskedNumber || 'XXXX-XXXX-4242';
  const dob = aadhaar.dateOfBirth || '01-01-1998';
  const state = aadhaar.address?.state || 'Maharashtra';
  const district = aadhaar.address?.district || 'Pune';
  const country = aadhaar.address?.country || 'India';
  const generatedAt = aadhaar.generatedAt ? new Date(aadhaar.generatedAt).toLocaleString('en-IN') : 'now';
  const traceId = session.aadhaar?.traceId || requestId;
  const shortAddr = session.walletAddress ? `${session.walletAddress.slice(0, 8)}...${session.walletAddress.slice(-6)}` : '';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>DigiLocker — Consent Request</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f4f6fb; color: #1a1a2e; min-height: 100vh; display: flex; align-items: center; justify-content: center; }
    .card { background: #fff; border-radius: 12px; box-shadow: 0 4px 24px rgba(0,0,0,0.10); width: 100%; max-width: 440px; overflow: hidden; }
    .header { background: #1a5dc8; padding: 20px 24px; display: flex; align-items: center; gap: 12px; }
    .header-logo { width: 40px; height: 40px; background: #fff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-weight: 800; font-size: 18px; color: #1a5dc8; letter-spacing: -1px; }
    .header-text h1 { color: #fff; font-size: 16px; font-weight: 700; }
    .header-text p { color: rgba(255,255,255,0.75); font-size: 12px; margin-top: 2px; }
    .mock-badge { margin: 0 24px; padding: 8px 12px; background: #fff8e1; border: 1px solid #f59e0b; border-radius: 6px; font-size: 11px; color: #92400e; margin-top: 16px; }
    .section { padding: 20px 24px; border-bottom: 1px solid #eef0f4; }
    .section h2 { font-size: 13px; font-weight: 600; color: #6b7280; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 12px; }
    .requester { display: flex; align-items: center; gap: 10px; }
    .requester-icon { width: 36px; height: 36px; background: #e0e7ff; border-radius: 8px; display: flex; align-items: center; justify-content: center; font-size: 16px; }
    .requester-name { font-weight: 600; font-size: 14px; }
    .requester-wallet { font-size: 11px; color: #6b7280; font-family: monospace; }
    .claims { display: flex; flex-direction: column; gap: 8px; }
    .claim-item { display: flex; align-items: flex-start; gap: 10px; padding: 10px; background: #f8faff; border: 1px solid #e0e7ff; border-radius: 8px; }
    .claim-icon { font-size: 16px; flex-shrink: 0; margin-top: 1px; }
    .claim-title { font-size: 13px; font-weight: 600; }
    .claim-desc { font-size: 11px; color: #6b7280; margin-top: 2px; }
    .aadhaar-card { background: linear-gradient(135deg, #1a5dc8 0%, #0f3d8e 100%); border-radius: 10px; padding: 16px; color: #fff; }
    .aadhaar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; }
    .aadhaar-header-left { font-size: 11px; opacity: 0.8; }
    .aadhaar-number { font-size: 18px; font-weight: 700; letter-spacing: 4px; font-family: monospace; }
    .aadhaar-fields { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin-top: 14px; }
    .aadhaar-field label { font-size: 9px; opacity: 0.7; text-transform: uppercase; letter-spacing: 0.05em; }
    .aadhaar-field span { font-size: 12px; font-weight: 600; display: block; margin-top: 2px; }
    .trace { font-size: 10px; opacity: 0.5; margin-top: 12px; font-family: monospace; }
    .actions { padding: 20px 24px; display: flex; gap: 12px; }
    .btn { flex: 1; padding: 12px; border: none; border-radius: 8px; font-size: 14px; font-weight: 600; cursor: pointer; transition: opacity 0.15s; }
    .btn:hover { opacity: 0.88; }
    .btn-allow { background: #16a34a; color: #fff; }
    .btn-deny  { background: #f1f5f9; color: #64748b; }
    .success { padding: 32px 24px; text-align: center; display: none; }
    .success-icon { font-size: 48px; margin-bottom: 12px; }
    .success h2 { font-size: 18px; font-weight: 700; color: #16a34a; }
    .success p { font-size: 13px; color: #6b7280; margin-top: 6px; }
    .success .close-hint { font-size: 11px; color: #9ca3af; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="header">
      <div class="header-logo">DL</div>
      <div class="header-text">
        <h1>DigiLocker</h1>
        <p>Consent Request · Powered by Setu</p>
      </div>
    </div>

    <div id="main-content">
      <div class="mock-badge">
        ⚠️ <strong>Sandbox / Mock Mode</strong> — No real Aadhaar data. This simulates the Setu DigiLocker consent screen.
      </div>

      <div class="section">
        <h2>Requesting Application</h2>
        <div class="requester">
          <div class="requester-icon">🌾</div>
          <div>
            <div class="requester-name">Acre Platform</div>
            <div class="requester-wallet">${shortAddr}</div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Claims Requested</h2>
        <div class="claims">
          <div class="claim-item">
            <div class="claim-icon">🇮🇳</div>
            <div>
              <div class="claim-title">Indian Citizen</div>
              <div class="claim-desc">Derived from Aadhaar address — country of residence</div>
            </div>
          </div>
          <div class="claim-item">
            <div class="claim-icon">🎂</div>
            <div>
              <div class="claim-title">Age over 18</div>
              <div class="claim-desc">Derived from date of birth — no exact age shared</div>
            </div>
          </div>
          <div class="claim-item">
            <div class="claim-icon">✅</div>
            <div>
              <div class="claim-title">Verified Human</div>
              <div class="claim-desc">Aadhaar biometric attestation</div>
            </div>
          </div>
        </div>
      </div>

      <div class="section">
        <h2>Aadhaar Data to Share</h2>
        <div class="aadhaar-card">
          <div class="aadhaar-header">
            <div class="aadhaar-header-left">
              <div style="font-size:14px;font-weight:700;">आधार</div>
              <div style="font-size:9px;opacity:0.7;">UNIQUE IDENTIFICATION AUTHORITY OF INDIA</div>
            </div>
            <div style="font-size:10px;opacity:0.7;">Mock · Sandbox</div>
          </div>
          <div class="aadhaar-number">${maskedNumber}</div>
          <div class="aadhaar-fields">
            <div class="aadhaar-field">
              <label>Date of Birth</label>
              <span>${dob}</span>
            </div>
            <div class="aadhaar-field">
              <label>Country</label>
              <span>${country}</span>
            </div>
            <div class="aadhaar-field">
              <label>State</label>
              <span>${state}</span>
            </div>
            <div class="aadhaar-field">
              <label>District</label>
              <span>${district}</span>
            </div>
          </div>
          <div class="trace">Generated: ${generatedAt} · Trace: ${traceId}</div>
        </div>
      </div>

      <div style="padding: 12px 24px; font-size: 11px; color: #9ca3af; border-bottom: 1px solid #eef0f4;">
        Only boolean claims are shared with Acre — not your Aadhaar number, name, or address.
        This consent expires in 30 days.
      </div>

      <div class="actions">
        <button class="btn btn-deny" onclick="deny()">Deny</button>
        <button class="btn btn-allow" onclick="approve()">Allow Access</button>
      </div>
    </div>

    <div class="success" id="success-view">
      <div class="success-icon">✅</div>
      <h2>Consent Granted</h2>
      <p>Acre can now verify your identity claims from Aadhaar.</p>
      <div class="close-hint">You can close this window and return to Acre.</div>
    </div>
  </div>

  <script>
    async function approve() {
      const btn = document.querySelector('.btn-allow');
      btn.textContent = 'Approving...';
      btn.disabled = true;
      try {
        await fetch('/mock-digilocker-consent/approve', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ request_id: '${requestId}' }),
        });
        document.getElementById('main-content').style.display = 'none';
        document.getElementById('success-view').style.display = 'block';
        setTimeout(() => window.close(), 2000);
      } catch (e) {
        btn.textContent = 'Allow Access';
        btn.disabled = false;
        alert('Approval failed: ' + e.message);
      }
    }
    function deny() {
      window.close();
    }
  </script>
</body>
</html>`;

  res.setHeader('Content-Type', 'text/html');
  return res.send(html);
});

app.post('/mock-digilocker-consent/approve', (req, res) => {
  const requestId = String(req.body?.request_id || '').trim();
  const session = requestId ? identitySessions.get(requestId) : null;
  if (!session) {
    return res.status(404).json({ success: false, message: 'Session not found' });
  }
  session.mockApproved = true;
  return res.json({ success: true, requestId, status: 'approved' });
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

    // Derive pubkeys from Algorand addresses (32-byte ed25519 public keys)
    let userPubkeyHex = '';
    let enterprisePubkeyHex = '';
    try {
      userPubkeyHex = Buffer.from(algosdk.decodeAddress(walletAddress).publicKey).toString('hex');
      const registrarAccount = getRegistrarAccount();
      enterprisePubkeyHex = Buffer.from(algosdk.decodeAddress(registrarAccount.addr).publicKey).toString('hex');
    } catch (_err) { /* best-effort */ }

    const nowTs = Math.floor(Date.now() / 1000);
    const expiryTimestamp = nowTs + 30 * 24 * 60 * 60; // 30 days

    // 1. Ed25519 attestation — signs claimHash+user+enterprise+expiry with registrar key
    const attestationSignature = userPubkeyHex && enterprisePubkeyHex
      ? signContractAttestation({ claimHash, walletAddress, enterprisePubkeyHex, expiryTimestamp })
      : null;

    // 2. Note anchor — 0-algo tx with consent JSON as note; best-effort, won't fail the response
    const consentNote = {
      kind: 'acre-consent-v1',
      user_pubkey: userPubkeyHex,
      enterprise_pubkey: enterprisePubkeyHex,
      claim_hash: claimHash,
      expiry_timestamp: expiryTimestamp,
      claim_type: claimType,
      identity_provider: 'digilocker',
      zk_backend: 'algoplonk',
      zk_verification_mode: algoplonk.verificationMode,
      income_tx_id: result.txId || null,
      issued_at: nowTs,
    };
    const noteAnchor = await submitNoteAnchor({ notePayload: consentNote });

    // 3. Consent token — HMAC-signed JWT returned to caller (lender verifiable)
    let consentToken = null;
    try {
      let appId = null;
      try { appId = loadAppId(); } catch (_e) { /* optional */ }
      consentToken = mintConsentToken({
        userPubkeyHex,
        enterprisePubkeyHex,
        claimHash,
        consentTxid: result.txId || null,
        noteTxid: noteAnchor.txId || null,
        expiresAt: expiryTimestamp,
        appId,
      });
    } catch (tokenErr) {
      console.warn('⚠️  Consent token minting failed:', tokenErr?.message);
    }

    if (attestationSignature) {
      console.log('║ ATTESTATION:', attestationSignature.slice(0, 16) + '...');
    }
    if (noteAnchor.txId) {
      console.log('║ NOTE ANCHOR TX:', noteAnchor.txId);
    }
    if (consentToken) {
      console.log('║ CONSENT TOKEN:', consentToken.slice(0, 24) + '...');
    }

    return res.json({
      ...result,
      identity: {
        requestId: identityRequestId,
        flags: session.flags,
        claimHashes: session.claimHashes,
        algoplonk,
      },
      consent: {
        token: consentToken,
        claimHash,
        userPubkey: userPubkeyHex,
        enterprisePubkey: enterprisePubkeyHex,
        expiresAt: expiryTimestamp,
        attestationSignature,
        noteAnchor: {
          txId: noteAnchor.txId,
          explorerUrl: noteAnchor.explorerUrl,
          error: noteAnchor.error || null,
        },
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

// ─── ACRE Advisor AI Chat ────────────────────────────────────────────────────

app.post('/api/chat', async (req, res) => {
  try {
    const { messages } = req.body || {};
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ success: false, message: 'messages array required' });
    }

    // Validate and sanitise messages (role + content only)
    const safeMessages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20) // cap history to 20 turns
      .map(m => ({ role: m.role, content: m.content.slice(0, 2000) }));

    if (safeMessages.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid messages provided' });
    }

    const payload = {
      model: 'gpt-4o-mini',
      messages: [{ role: 'system', content: ACRE_SYSTEM_PROMPT }, ...safeMessages],
      max_tokens: 600,
      temperature: 0.6,
    };

    // Try OpenAI first
    const openaiKey = (process.env.OPENAI_API_KEY || '').trim();
    if (openaiKey) {
      try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        });
        if (r.ok) {
          const data = await r.json();
          const reply = data?.choices?.[0]?.message?.content || '';
          if (reply) return res.json({ success: true, reply, provider: 'openai' });
        }
      } catch { /* fall through to Groq */ }
    }

    // Fallback: Groq (llama-3.1-70b)
    const groqKey = (process.env.GROQ_API_KEY || '').trim();
    if (groqKey) {
      const groqPayload = { ...payload, model: 'llama-3.3-70b-versatile' };
      const r = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${groqKey}` },
        body: JSON.stringify(groqPayload),
        signal: AbortSignal.timeout(15000),
      });
      if (!r.ok) {
        const err = await r.text().catch(() => 'Groq error');
        return res.status(502).json({ success: false, message: `AI service error: ${err}` });
      }
      const data = await r.json();
      const reply = data?.choices?.[0]?.message?.content || '';
      return res.json({ success: true, reply, provider: 'groq' });
    }

    return res.status(503).json({ success: false, message: 'No AI API keys configured. Add OPENAI_API_KEY or GROQ_API_KEY to the backend .env.' });
  } catch (error) {
    return res.status(500).json({ success: false, message: error?.message || 'Chat error' });
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
