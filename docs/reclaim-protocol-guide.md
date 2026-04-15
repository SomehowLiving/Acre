# Reclaim Protocol - Complete Guide

## 📋 Table of Contents
1. [What is Reclaim Protocol](#what-is-reclaim-protocol)
2. [How It Works: Architecture](#how-it-works-architecture)
3. [Comparison with Alternatives](#comparison-with-alternatives)
4. [Providers & Integrations](#providers--integrations)
5. [Step-by-Step User Flow](#step-by-step-user-flow)
6. [Developer Integration Guide](#developer-integration-guide)
7. [Real Projects Using Reclaim](#real-projects-using-reclaim)
8. [Security Model](#security-model)
9. [Troubleshooting & FAQs](#troubleshooting--faqs)

---

## What is Reclaim Protocol

### Simple Definition
Reclaim Protocol is a **Zero-Knowledge Attestation Service** that proves data from web services (Uber, banks, Twitter, etc.) without revealing the raw data.

### The Problem It Solves

**Scenario 1: Traditional Fintech**
```
Worker → Uploads PDF bank statement → Fintech stores it
Risk: Privacy breach, DPDP violation, hacking target
```

**Scenario 2: With Reclaim Protocol**
```
Worker → Logs into bank (on their device) → Reclaim witnesses TLS
→ Worker's device generates ZK proof: "Balance > ₹50,000"
→ Fintech receives only proof (200 bytes, not the statement)
Result: Privacy preserved, DPDP compliant, no data storage
```

### Key Features

| Feature | Benefit |
|---------|---------|
| **2500+ Providers** | Uber, banks, Instagram, Coursera, Stripe, etc. |
| **Zero-Knowledge** | No raw data exposed to our platform |
| **DPDP Compliant** | We're not a data fiduciary |
| **Fast** | 2-4 seconds for verification |
| **Easy Integration** | 5-minute SDK setup |
| **Decentralized** | Works with any blockchain (Algorand, Ethereum, Solana, etc.) |

---

## How It Works: Architecture

### High-Level Flow

```
┌─────────────────────────┐
│   Worker's Browser      │
│  ┌─────────────────┐    │
│  │ Clicks "Connect │    │
│  │ Uber Income"    │    │
│  └────────┬────────┘    │
└───────────┼─────────────┘
            │
            ▼
┌─────────────────────────┐
│  Reclaim Protocol       │
│  ┌─────────────────┐    │
│  │ 1. Opens secure │    │
│  │ login window    │    │
│  └────────┬────────┘    │
└───────────┼─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Uber Servers          │
│  ┌─────────────────┐    │
│  │ 2. TLS session  │    │
│  │ established     │    │
│  │ (encrypted)     │    │
│  └────────┬────────┘    │
└───────────┼─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Reclaim Attestor      │
│  ┌─────────────────┐    │
│  │ 3. Witnesses    │    │
│  │ encrypted bytes │    │
│  │ (can't decrypt) │    │
│  └────────┬────────┘    │
└───────────┼─────────────┘
            │
            ▼
┌─────────────────────────┐
│   Worker's Device       │
│  ┌─────────────────┐    │
│  │ 4. Extracts:    │    │
│  │ "earnings=45000"│    │
│  │ 5. Generates ZK │    │
│  │ proof           │    │
│  └────────┬────────┘    │
└───────────┼─────────────┘
            │
            ▼
┌─────────────────────────┐
│   our Acre Platform    │
│  ┌─────────────────┐    │
│  │ 6. Receives:    │    │
│  │ Proof (200B)    │    │
│  │ Verifies        │    │
│  │ 7. Credit tier: │    │
│  │ Tier 2          │    │
│  └─────────────────┘    │
└─────────────────────────┘
```

### Detailed Technical Flow

#### Step 1: User Initiates Verification
```javascript
// our frontend
const reclaim = await ReclaimProofRequest.init(
  'APP_ID',
  'APP_SECRET',
  'uber-driver-earnings' // Provider ID
);

const { requestUrl } = await reclaim.createVerificationRequest();
// requestUrl = "https://reclaim.ai/verify/abc123xyz..."
```

**What Happens**:
- Reclaim generates a unique session ID
- Creates a QR code or link containing the session ID
- No data is sent yet

---

#### Step 2: User Scans QR / Clicks Link
```
QR Code: https://reclaim.ai/verify/abc123xyz/
User scans with phone → Opens Reclaim's secure mobile app
```

**What Happens**:
- Reclaim app opens on user's phone
- Shows: "Connect our Uber account?"
- User clicks "Continue"

---

#### Step 3: User Logs Into Uber
```
User enters Uber username/password
↓
Uber verifies credentials
↓
TLS session established between User ↔ Uber servers
```

**What's Key Here**:
- Connection is encrypted end-to-end
- User's credentials are only sent to Uber (not Reclaim)
- Reclaim acts as a network observer (can see encrypted bytes, not content)

---

#### Step 4: Reclaim Attestor Witnesses TLS
```
User ↔ Uber (encrypted TLS)
      ↑
      │ Reclaim witnesses encrypted bytes
      │ (cannot decrypt without user's private key)
      │
Reclaim Attestor
```

**Cryptographic Detail**:
- TLS handshake uses symmetric + asymmetric encryption
- Reclaim sees the encrypted data stream
- Only the user's device has the session keys to decrypt
- Reclaim certifies: "Yes, this came from uber.com"

---

#### Step 5: User Extracts Specific Data
```json
// Uber API returns (encrypted)
{
  "earnings": {
    "monthly_total": 45230,
    "currency": "INR",
    "last_updated": "2024-03-15"
  },
  "trips": {
    "total_trips": 1200,
    "completed_trips": 1198,
    "cancelled_by_user": 2
  },
  // ... more data
}

// User's device extracts ONLY:
{
  "monthly_earnings": 45230,
  "consistency_months": 6
}
```

**Why This Matters**:
- User chooses what to reveal (not everything)
- The full API response stays on the device
- Reclaim never sees the raw response

---

#### Step 6: User's Device Generates ZK Proof
```
Proof circuit (in Reclaim's backend, runs locally):

Input (private):
  - monthly_earnings: 45230
  - months_consistent: 6

Output (public):
  - income_band: 2 (₹25k-50k)
  - consistency_months: 6
  - source_verified: true
  - proof_hash: 0xabc123...

Generate zero-knowledge proof that:
  ✓ monthly_earnings >= 25000 AND <= 50000
  ✓ consistency_months >= 3
  ✓ Data came from uber.com
  WITHOUT revealing the exact amount (45230)
```

**Cryptographic Magic**:
- SNARK or VOLE-ZK algorithm generates proof
- Proof size: ~200 bytes
- Verification: 1ms (very fast)
- Cannot derive private inputs from proof

---

#### Step 7: Proof Sent to our Platform
```
User's device sends to our backend:
{
  "sessionId": "abc123xyz",
  "proof": {
    "claimData": {
      "provider": "uber",
      "email": "user@example.com",
      "data": {
        "income_band": 2,
        "consistency_months": 6
      }
    },
    "signatures": {
      "attestor_signature": "0xsig123...",
      "user_signature": "0xuser456..."
    },
    "publicSignals": [2, 6, 1, "0xhash..."]
  }
}
```

**What our Platform Receives**:
- ✅ Income band (1, 2, or 3) - not exact amount
- ✅ Proof of consistency (months)
- ✅ Cryptographic signatures (proof of origin)
- ✅ Source verification (came from uber.com)
- ❌ Raw earnings amount (not in proof)
- ❌ Full API response (stays on device)
- ❌ User credentials (never sent)

---

#### Step 8: our Platform Verifies & Stores
```javascript
// In our backend
const isValid = Reclaim.verifyProof(proof);
if (!isValid) return "Invalid proof";

// Extract from proof
const tier = proof.claimData.data.income_band; // 2
const months = proof.claimData.data.consistency_months; // 6

// Map to credit
if (tier === 2) {
  creditLimit = 50000;
  interestRate = 12;
}

// Store on Algorand
smart_contract.verify_income_proof(
  proof_hash,
  tier,
  creditLimit
);
```

**What we Store**:
- Proof hash (200 bytes)
- Income tier (1-3)
- Credit limit (number)
- Timestamp
- Reputation score
- ❌ NOT the raw proof
- ❌ NOT the earnings amount
- ❌ NOT any PII

---

### Data Flow Summary

```
┌─────────────────────────────────────────────────────┐
│                   RAW DATA JOURNEY                  │
├─────────────────────────────────────────────────────┤
│  ✅ Uber API response: Encrypted on TLS             │
│  ✅ Decrypted on user's device ONLY                 │
│  ✅ User selects what to reveal                     │
│  ✅ ZK proof generated (no data exposure)           │
│  ✅ Only proof sent to Reclaim & our platform      │
│  ❌ Raw data never leaves device                    │
│  ❌ our platform NEVER sees earnings number        │
│  ❌ Reclaim NEVER sees earnings number              │
│  ❌ No data residue after verification              │
└─────────────────────────────────────────────────────┘
```

---

## Comparison with Alternatives

### Option 1: Reclaim Protocol (Recommended for MVP)

**Pros**:
- ✅ 2500+ providers ready to use
- ✅ 2-4 second verification
- ✅ Easy SDK integration (5 minutes)
- ✅ Mobile + browser support
- ✅ Handles Uber, banks, everything
- ✅ Zero data exposure
- ✅ Already battle-tested (3Jane, Earnify, etc.)

**Cons**:
- ❌ we depend on Reclaim's attestor network
- ❌ Must pay Reclaim for verification (~$0.05-0.10 per proof)
- ❌ Not fully decentralized

**Best For**: Hackathon MVP, quick product launch, anything launched <3 months

---

### Option 2: TLSNotary (Maximum Decentralization)

**Architecture**:
```
User installs TLSNotary extension
    ↓
Extension performs TLS handshake (with our participation)
    ↓
we (verifier) + User participate in MPC (Multi-Party Computation)
    ↓
Neither party can decrypt alone
    ↓
Proof generated without revealing data
```

**Pros**:
- ✅ Fully decentralized (no single attestor)
- ✅ We run the verifier (full control)
- ✅ Can work with any HTTPS API
- ✅ No ongoing fees (one-time infrastructure)

**Cons**:
- ❌ Requires browser extension installation
- ❌ Complex to implement (~5 days of engineering)
- ❌ Need to run our own verifier server
- ❌ 10-30 seconds per proof (slower)
- ❌ Needs plugin for each data source

**Best For**: Production, maximum decentralization, willing to invest engineering time

**Real Examples**:
- Bring ID: Uses TLSNotary to prove "at least one Uber trip"
- OpenLex: Uses TLSNotary to verify legal documents

---

### Option 3: zkPass (TransGate)

**Architecture**:
```
User installs TransGate Chrome extension
    ↓
Extension opens secure popup for Uber login
    ↓
Extension captures TLS session locally
    ↓
ZK proof generated on device
    ↓
Proof sent to our dApp
```

**Pros**:
- ✅ Fast verification (<1 second)
- ✅ Supports Uber + Instagram + Coursera specifically
- ✅ Good UX (Chrome extension)
- ✅ VOLE-ZK proofs (very efficient)

**Cons**:
- ❌ Chrome extension required
- ❌ Limited provider support (not 2500+)
- ❌ Newer platform (less battle-tested)

**Best For**: Chrome users, Uber-specific use case, UX-focused

---

### Option 4: Opacity Network (HR/Payroll Only)

**Use Case**: Verify employment & income from ADP, Gusto, Workday

**Pros**:
- ✅ Specialized for payroll (very good at that)
- ✅ Works with major HR systems

**Cons**:
- ❌ Only HR providers (not Uber or banks)
- ❌ TEE-based (trusted execution environment, not ZK)
- ❌ More centralized than ZK solutions

**Best For**: Employment verification, hourly wage proof, salaried employees

---

### Comparison Matrix

| Feature | Reclaim | TLSNotary | zkPass | Opacity |
|---------|---------|-----------|--------|---------|
| **Providers** | 2500+ | Any HTTPS | ~50 | HR only |
| **Speed** | 2-4s | 10-30s | <1s | 2-5s |
| **Setup Time** | 5 min | 5 days | 30 min | 1 hour |
| **Cost** | $0.05/proof | Free | Free | TBD |
| **Decentralization** | Medium | High | Medium | Low |
| **Mobile Support** | Yes | No (browser only) | Yes | Yes |
| **Uber Support** | Yes | Yes* | Yes | No |
| **Bank Support** | Yes (Plaid) | Yes* | Yes | No |
| **Maturity** | Production | Production | Beta | Beta |

\* With custom plugin development

---

## Providers & Integrations

### Income & Earnings (For our Use Case)

#### Gig Platforms
| Provider | ID | Returns | Use Case |
|----------|----|---------|---------| 
| **Uber Driver** | `uber-driver-earnings` | Monthly earnings, trip count, ratings | Uber drivers applying for loans |
| **Upwork** | `upwork-earnings` | Total earnings, hourly rate, jobs completed | Freelancers for income verification |
| **Fiverr** | `fiverr-seller-earnings` | Monthly earnings, order count, reviews | Freelancers for income verification |
| **TaskRabbit** | `taskrabbit-earnings` | Monthly earnings, tasks completed | Gig workers for income verification |
| **Instacart** | `instacart-earnings` | Weekly/monthly earnings, batch count | Gig workers |

#### Banking & Financial
| Provider | ID | Returns | Use Case |
|----------|----|---------|---------| 
| **Plaid Bank Balance** | `plaid-bank-balance` | Account balance, transaction history | Traditional income / savings proof |
| **Stripe Revenue** | `stripe-revenue` | Monthly revenue, payment count | Merchants for loans |
| **Razorpay Payouts** | `razorpay-payouts` | Monthly settlement, transaction volume | Indian merchants |
| **PayPal Revenue** | `paypal-revenue` | Monthly sales, transaction count | Online sellers |

#### Employment & HR
| Provider | ID | Returns | Use Case |
|----------|----|---------|---------| 
| **LinkedIn Employment** | `linkedin-employment` | Current job, title, salary range | Employment verification |
| **ADP Payroll** | `adp-payroll` | Salary, YTD earnings, employment status | Traditional employees |
| **Gusto Payroll** | `gusto-payroll` | Paycheck stubs, YTD earnings | Small business employees |

#### Social & Credibility
| Provider | ID | Returns | Use Case |
|----------|----|---------|---------| 
| **Twitter Followers** | `twitter-followers` | Follower count, verification status | Influencer verification |
| **GitHub Profile** | `github-contributions` | Contribution count, repo count | Developer verification |
| **LinkedIn Endorsements** | `linkedin-endorsements` | Endorsement count, skill verification | Professional credibility |

### How to Access Providers

#### Step 1: Sign Up on Reclaim
```
Go to: https://reclaimprotocol.org
Click: "Developer Dashboard"
Sign up with email/wallet
```

#### Step 2: Create Application
```
Dashboard → "Create New App"
Fill in:
  - App Name: "Acre Protocol"
  - Description: "Income verification for gig workers"
  - Website: "https://acre.oursite.com"
  
Get: APP_ID and APP_SECRET
```

#### Step 3: Enable Providers
```
Dashboard → "Providers"
Search: "uber-driver-earnings"
Click: "Enable for our app"

Repeat for: plaid-bank-balance, linkedin-employment, etc.
```

#### Step 4: Set Configuration
```
Redirect URL: https://acre.oursite.com/callback
Webhook URL: https://acre.oursite.com/webhook
(optional - for server-side notification)
```

---

## Step-by-Step User Flow

### Scenario 1: Uber Driver Verifying Income

```
Timeline: User opens our dApp

T+0:00 - User sees landing page
┌──────────────────────────┐
│   Acre Protocol          │
│  ┌──────────────────┐    │
│  │ Income Loan      │    │
│  │ Platform         │    │
│  │                  │    │
│  │ [Connect Income] │    │ ← User clicks here
│  └──────────────────┘    │
└──────────────────────────┘

T+0:05 - Frontend initializes Reclaim
Code:
  const reclaim = await ReclaimProofRequest.init(
    'APP_ID',
    'APP_SECRET',
    'uber-driver-earnings'
  );

T+0:10 - QR code displays
┌──────────────────────────┐
│   Acre Platform          │
│  ┌──────────────────┐    │
│  │ Scan QR code:    │    │
│  │  ┌────────────┐  │    │
│  │  │ ▓▓▓▓▓▓▓▓▓▓│  │    │
│  │  │ ▓ ▓▓▓  ▓  │  │    │
│  │  │ ▓ ▓▓▓  ▓  │  │    │
│  │  │ ▓        ▓  │    │
│  │  │ ▓▓▓▓▓▓▓▓▓▓│  │    │
│  │  └────────────┘  │    │
│  └──────────────────┘    │
└──────────────────────────┘

T+0:15 - User scans QR with phone
  Redirects to: https://reclaim.ai/verify/abc123...

T+0:20 - Reclaim app opens
┌─────────────────────────────────────────┐
│         Reclaim Protocol Mobile          │
│  ┌──────────────────────────────────┐   │
│  │ Connect our Uber account?       │   │
│  │                                  │   │
│  │ [Continue with Uber]             │   │ ← User clicks
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

T+0:25 - Uber login popup opens
┌─────────────────────────────────────────┐
│           Uber Login (Secure)            │
│  ┌──────────────────────────────────┐   │
│  │ Email: [user@example.com       ] │   │
│  │ Password: [................... ] │   │
│  │                                  │   │
│  │ [Login]                          │   │ ← User enters credentials
│  └──────────────────────────────────┘   │
└─────────────────────────────────────────┘

T+0:30 - User logs in
  TLS handshake: User device ↔ Uber servers (encrypted)
  Reclaim attestor witnesses (cannot decrypt)

T+1:00 - Uber returns earnings data (encrypted)
```json
{
  "monthly_earnings": 45230,
  "earnings_currency": "INR",
  "trips_completed": 1198,
  "total_trips": 1200,
  "cancellation_rate": 0.17,
  "rating": 4.85,
  "last_30_days_earnings": 45230,
  "last_90_days_earnings": 132890,
  "account_created": "2020-05-15",
  "active_status": true
}
```

T+1:10 - User's device extracts selective data
```json
{
  "monthly_earnings": 45230,
  "consistency_months": 42,
  "source": "uber.com",
  "account_age_months": 42
}
```

T+1:20 - User's device generates ZK proof
Algorithm: SNARK/VOLE-ZK
Proof: "I know monthly_earnings such that:
  - monthly_earnings >= 25000
  - monthly_earnings <= 50000
  - account_age_months >= 12
  - source verification passed"
Without revealing: The exact amount (45230)

Output:
```json
{
  "proof_size_bytes": 200,
  "public_signals": [
    "income_band_2",
    "consistency_42_months",
    "verified_uber_source",
    "proof_hash_0xabc123"
  ]
}
```

T+1:30 - Proof sent back to our dApp
Browser receives callback:
```javascript
{
  "sessionId": "abc123xyz",
  "claimData": {
    "provider": "uber",
    "email": "user@example.com",
    "data": {
      "income_band": 2,
      "consistency_months": 42,
      "source_verified": true
    }
  },
  "signatures": {
    "attestor_sig": "0xsig...",
    "user_sig": "0xuser..."
  }
}
```

T+1:35 - our dApp shows success
┌──────────────────────────────────────┐
│        Acre Platform (Browser)        │
│  ┌────────────────────────────────┐  │
│  │ ✓ Income Verified!             │  │
│  │                                │  │
│  │ Tier: 2                        │  │
│  │ Monthly Income Band: ₹25k-50k  │  │
│  │ Credit Limit: ₹50,000          │  │
│  │ Interest Rate: 12%             │  │
│  │                                │  │
│  │ [Request Loan]                 │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘

T+1:45 - our dApp submits proof to Algorand
Transaction: verify_income_proof(
  proof_hash,
  income_band_2,
  credit_limit_50000,
  timestamp
)

T+2:00 - Algorand verifies
┌──────────────────────────────────────────┐
│       Algorand Smart Contract            │
│  1. Verify Reclaim signature: ✓         │
│  2. Check proof freshness: ✓            │
│  3. Validate income band: ✓             │
│  4. Assign credit tier: TIER 2          │
│  5. Store on-chain: ✓                   │
│  6. Emit event: INCOME_VERIFIED         │
└──────────────────────────────────────────┘

T+2:10 - Complete flow shown
┌──────────────────────────────────────┐
│     Acre Platform (Final State)       │
│  ┌────────────────────────────────┐  │
│  │ ✓ Verification Complete        │  │
│  │                                │  │
│  │ Income Band: TIER 2            │  │
│  │ Credit Limit: ₹50,000          │  │
│  │ our Reputation: 50 points     │  │
│  │ Interest Rate: 12%             │  │
│  │                                │  │
│  │ Transaction Confirmed:         │  │
│  │ https://testnet.algorand/      │  │
│  │   tx/ABC123...                 │  │
│  │                                │  │
│  │ [Request Loan Now]             │  │
│  │ [View Loan History]            │  │
│  │ [Invite a Friend]              │  │
│  └────────────────────────────────┘  │
└──────────────────────────────────────┘
```

### Scenario 2: Bank Account Balance Verification

```
Same flow as above, but:

Provider ID: 'plaid-bank-balance'

Reclaim connects to bank via Plaid API:
  - Supports 12,000+ banks globally
  - India: HDFC, ICICI, Axis, Yes Bank, etc.

User logs in with bank credentials
Reclaim attestor witnesses
User device extracts:
  {
    "balance": 150000,
    "account_age_months": 24,
    "monthly_inflow": 35000
  }

ZK proof: "I know balance such that:
  - balance >= 100000
  - monthly_inflow >= 25000
  - account_age_months >= 12"

Result: Credit tier based on balance + monthly inflow
```

---

## Developer Integration Guide

### Quick Start (5 Minutes)

#### Step 1: Install Reclaim SDK

```bash
npm install @reclaimprotocol/js-sdk
```

#### Step 2: Frontend Component

```javascript
import { ReclaimProofRequest } from '@reclaimprotocol/js-sdk';
import { useState } from 'react';

function IncomeVerification() {
  const [proof, setProof] = useState(null);

  const handleConnect = async () => {
    // Initialize Reclaim
    const reclaim = await ReclaimProofRequest.init(
      'our_APP_ID',      // Get from https://reclaimprotocol.org
      'our_APP_SECRET',
      'uber-driver-earnings' // Provider
    );

    // Start verification flow
    await reclaim.startSession({
      onSuccess: (proof) => {
        console.log('Proof received:', proof);
        setProof(proof);
        
        // Send to our backend/smart contract
        submitToAlgorand(proof);
      },
      onError: (error) => {
        console.error('Error:', error);
      }
    });
  };

  return (
    <>
      <button onClick={handleConnect}>
        Connect Uber Income
      </button>
      {proof && <div>Verification successful!</div>}
    </>
  );
}
```

#### Step 3: Verify Proof on Backend

```javascript
// Node.js backend
import { Reclaim } from '@reclaimprotocol/js-sdk';

app.post('/api/verify-income', async (req, res) => {
  const { proof } = req.body;

  // Verify proof authenticity
  try {
    const isValid = await Reclaim.verifyProof(proof);
    if (!isValid) return res.status(400).json({ error: 'Invalid proof' });

    // Extract data
    const incomeBand = proof.claimData.data.income_band;
    const consistencyMonths = proof.claimData.data.consistency_months;

    // Map to credit
    let creditLimit = 10000;
    if (incomeBand === 2) creditLimit = 50000;
    if (incomeBand === 3) creditLimit = 150000;

    // Submit to Algorand
    const txId = await submitToAlgorand({
      walletAddress: req.user.wallet,
      creditLimit,
      tier: incomeBand
    });

    res.json({ success: true, creditLimit, txId });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
```

#### Step 4: Deploy & Test

```bash
# Set environment variables
export RECLAIM_APP_ID=our_app_id
export RECLAIM_APP_SECRET=our_app_secret

# Deploy
npm run build
vercel deploy  # or our hosting provider
```

### Advanced Integration: Multiple Providers

```javascript
// Support multiple income sources
const PROVIDERS = {
  UBER: 'uber-driver-earnings',
  UPWORK: 'upwork-earnings',
  BANK: 'plaid-bank-balance',
  PAYPAL: 'paypal-revenue',
  LINKEDIN: 'linkedin-employment'
};

async function verifyMultipleSources(sources) {
  const proofs = [];

  for (const source of sources) {
    const reclaim = await ReclaimProofRequest.init(
      APP_ID,
      APP_SECRET,
      PROVIDERS[source]
    );

    const proof = await reclaim.startSession();
    proofs.push(proof);
  }

  // Combine proofs for stronger verification
  const combinedVerification = await submitCombinedProofs(proofs);
  
  return combinedVerification;
}
```

---

## Real Projects Using Reclaim

### 1. 3Jane (Under-Collateralized Lending)

**What They Do**: Provide loans to individuals without requiring collateral

**How They Use Reclaim**:
```
1. User connects bank account via Reclaim (Plaid)
2. Reclaim proves: "Account balance > ₹50,000"
3. User connects credit score API
4. Reclaim proves: "CIBIL score > 600"
5. 3Jane issues loan without requiring collateral
```

**Result**: 
- Turned previously unbankable people into borrowers
- Loan approval time: <5 minutes
- Default rate: <3% (through reputation tracking)

---

### 2. Earnify (Gig Worker Wage Access)

**What They Do**: Help hourly workers access their earned wages before payday

**How They Use Reclaim**:
```
1. Worker opens app
2. Logs into employer payroll system (ADP, Gusto, etc.)
3. Earnify proves: "You earned ₹2,000 this week"
4. Instant advance: ₹2,000 available now
5. Repaid automatically on payday
```

**Result**:
- #1 Finance app on App Store (India)
- 500K+ users
- Processing $50M+ in advances annually

---

### 3. Bring ID (Proof of Personhood)

**What They Do**: Prove you're a real person without revealing identity

**How They Use Reclaim**:
```
1. User logs into Uber
2. Reclaim proves: "Has completed at least 1 Uber trip"
3. This proves: "Is a real person" (bots can't take Uber)
4. User gets proof without revealing which Uber account
```

**Result**:
- Sybil resistance for DAOs
- Privacy-preserving KYC
- Used by DeFi protocols

---

### 4. Aloy (Brand Loyalty, Hackathon Winner)

**What They Do**: Create on-chain loyalty programs verified by Web2 data

**How They Use Reclaim**:
```
1. Coffee shop customer has loyalty card
2. App shows: "You have 500 points"
3. Reclaim proves: "Customer has 500+ points"
4. Points converted to NFT
5. Can be traded or used at partner shops
```

**Status**: Winner of Reclaim side track at Superteam Colosseum Hackathon

---

### 5. XIONIS (Cross-Chain Lending)

**What They Do**: Dynamic collateralization based on verified income

**How They Use Reclaim**:
```
1. User proves income via Reclaim
2. User deposits crypto collateral
3. Collateral requirement = 120% of income
4. User borrows against income + collateral combo
```

**Result**:
- Better capital efficiency
- More users can access credit
- Cross-chain compatible

---

## Security Model

### What Reclaim Protects Against

#### Attack 1: Man-in-the-Middle (MITM)
```
Attacker tries to intercept Uber login
  ↓
TLS encryption prevents this
  ↓
Even if attacker sees encrypted bytes, can't decrypt
  ↓
Reclaim attestor verifies: "Bytes came from uber.com"
  ↓
MITM attack fails
```

**Defense**: TLS + Reclaim attestor signature

---

#### Attack 2: Fake Proofs
```
Attacker generates fake ZK proof
  ↓
our contract verifies Reclaim signature
  ↓
Fake proof has invalid signature
  ↓
Smart contract rejects
```

**Defense**: ECDSA signature verification

---

#### Attack 3: Proof Reuse
```
Attacker uses same proof for multiple loans
  ↓
our contract stores proof_hash on-chain
  ↓
Second submission: proof_hash already exists
  ↓
Contract rejects duplicate
```

**Defense**: Unique proof per verification, on-chain tracking

---

#### Attack 4: Proof Expiration
```
Attacker uses old proof from 1 year ago
  ↓
Proof contains timestamp
  ↓
Contract checks: "Proof must be <90 days old"
  ↓
Old proof rejected
```

**Defense**: Timestamp validation

---

### Privacy Guarantees

| Who | Sees | Doesn't See |
|-----|------|-------------|
| **our Platform** | Proof hash, Tier, Credit limit | Raw earnings, Account number, Full statements |
| **Reclaim Attestor** | Encrypted bytes, Domain cert | Decrypted data, User's private key |
| **Uber** | Normal login request | That proof will be generated |
| **Hacker (if breaches us)** | Proof hash, Tier, Credit limit | Raw financial data (encrypted before arrival) |

**DPDP Compliance**:
- ✅ we're not a Data Fiduciary
- ✅ we don't store raw data
- ✅ No data localization issues
- ✅ Breach has no raw data to steal

---

## Troubleshooting & FAQs

### Q: How much does Reclaim cost?
**A**: ~$0.05-0.10 per proof verification. Paid per API call, not per user.

```
our costs:
- 1,000 users = $50-100/month
- 10,000 users = $500-1,000/month
- 100,000 users = $5,000-10,000/month
```

---

### Q: How long does verification take?
**A**: 
- Frontend: Instant (QR appears immediately)
- User login: Depends on user typing speed (10-30 seconds)
- Proof generation: <2 seconds (on user's device)
- Backend verification: <100ms
- **Total**: 2-4 minutes (user experience)

---

### Q: Can a user cheat by using someone else's account?
**A**:
```
No, because:
1. They must provide credentials
2. Uber requires 2FA (SMS/app)
3. Proof is linked to their wallet address
4. We store their address on-chain
5. Consistency tracking prevents one-time cheating
```

If they use someone else's Uber, that account's reputation will be different, and We can flag it.

---

### Q: What if Reclaim goes down?
**A**:
- For hackathon: Not a problem (it won't)
- For production: Plan Phase 2 migration to TLSNotary
- Reclaim has 99.9% uptime SLA

---

### Q: Do I need to modify my app UI much?
**A**:
- No. Add one button: "Connect Income"
- Rest is Reclaim's flow (they handle login UI)
- After verification, We show our credit tier screen

---

### Q: Can users verify multiple income sources?
**A**: Yes. Call Reclaim multiple times:
```javascript
// Connect Uber
const uberProof = await verifyIncome('uber-driver-earnings');

// Connect Bank
const bankProof = await verifyIncome('plaid-bank-balance');

// Combine for stronger verification
const combinedTier = await calculateCombinedIncome([uberProof, bankProof]);
```

---

### Q: What if user's income changes?
**A**: They can re-verify anytime. We'll update their tier.

```
Month 1: Verify → Tier 2 (₹45k)
Month 6: Income dropped to ₹20k
User re-verifies → Tier 1 (₹20k)
Credit limit drops to ₹25,000
But reputation score is preserved (good repayment history)
```

---

### Q: Is Reclaim compliant with Indian regulations?
**A**:
- ✅ DPDP 2023: We're not a data fiduciary (We don't store raw data)
- ✅ No RBI license needed (We're not aggregating accounts)
- ✅ Works with Account Aggregator framework (can integrate with AA)
- ✅ Privacy by design (best practice)

---

### Q: How do I handle KYC/AML?
**A**: Separate from Reclaim. We still need:
1. Traditional KYC: Name, phone, ID
2. Reclaim: Income verification
3. AML: Sanctions list checking

Reclaim handles the income part, not identity.

---

### Q: Can I use Reclaim proofs for identity verification?
**A**: Not directly. But We can combine:
```
1. Reclaim proves: "Has Uber account with 1000+ trips"
   (proves real person, hard for bots)
2. We add: Traditional KYC for identity

Together: Prevents sybil + confirms real person
```

---

## Next Steps

### For our Acre MVP

1. **Sign up on Reclaim**: https://reclaimprotocol.org
2. **Get APP_ID & APP_SECRET**: Developer dashboard
3. **Enable providers**: uber-driver-earnings, plaid-bank-balance
4. **Copy the React code** from Section "Developer Integration Guide"
5. **Deploy frontend**: Vercel/Netlify
6. **Build Algorand contract** (see implementation-guide.md)
7. **Test end-to-end**: QR scan → proof → credit tier
8. **Demo for judges**: "Privacy-preserving income verification in 3 seconds"

### For Production (Phase 2)

1. **Migrate to TLSNotary**: Full decentralization
2. **Run our own attestor**: Independence from Reclaim
3. **Add more providers**: LinkedIn, Stripe, etc.
4. **Integrate with actual NBFCs**: Real loan disbursement
5. **Expand to other chains**: Polygon, Base, etc.

---

## Resources

- **Reclaim Documentation**: https://docs.reclaimprotocol.org
- **GitHub SDK**: https://github.com/reclaimprotocol/reclaim-js-sdk
- **Developer Dashboard**: https://reclaimprotocol.org/developer
- **Community**: https://discord.gg/reclaim
- **Blog**: https://reclaimprotocol.org/blog

---

## License & Attribution

- Reclaim Protocol: Open source (Apache 2.0)
- Our Acre Protocol: Use as per our license
- Integration examples: MIT or Apache 2.0 (choose)