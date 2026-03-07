# Acre — Privacy-Preserving Income Verification for Gig Workers

> **A zero-knowledge verification protocol that enables gig workers to prove income eligibility for loans — without revealing financial history.**

[![Built on Algorand](https://img.shields.io/badge/Built%20on-Algorand-00BCD4?style=flat-square)](https://algorand.com)
[![ZK Proofs](https://img.shields.io/badge/ZK%20Proofs-Noir-7C3AED?style=flat-square)](https://noir-lang.org)
[![Track](https://img.shields.io/badge/Track-Future%20of%20Finance%20%7C%20DPDP%20%26%20RegTech-orange?style=flat-square)](https://algobharat.in)
[![Hackathon](https://img.shields.io/badge/AlgoBharat-Hack%20Series%203.0-blue?style=flat-square)](https://algobharat.in)

---

## Table of Contents

1. [Problem Statement](#1-problem-statement)
2. [Solution Overview](#2-solution-overview)
3. [High-Level Architecture](#3-high-level-architecture)
4. [System Architecture](#4-system-architecture)
5. [User Journey Architecture](#5-user-journey-architecture)
6. [Core Components](#6-core-components)
7. [Why Algorand](#7-why-algorand)
8. [Privacy & Compliance (DPDP Act)](#8-privacy--compliance-dpdp-act)
9. [ZK Circuit Design](#9-zk-circuit-design)
10. [Smart Contract Logic](#10-smart-contract-logic)
11. [Demo Flow](#11-demo-flow)
12. [Project Structure](#12-project-structure)
13. [Setup & Installation](#13-setup--installation)
14. [Use Cases](#14-use-cases)
15. [Roadmap](#15-roadmap)
16. [References](#16-references)
17. [Team](#17-team)

---

## 1. Problem Statement

India's **1.2 crore gig workers** — Uber drivers, Swiggy delivery partners, Upwork freelancers — generate regular, verifiable platform income. Yet they remain **credit-invisible** to formal lenders.

### Why lenders reject them

Traditional lenders require:
- Salary slips from a permanent employer
- Formal payroll records
- Historical bank statements with stable inflows

Gig workers have **none of these in standard form**, despite earning consistently.

### Why sharing data isn't the answer

| Data Exposure Risk | Consequence |
|---|---|
| Raw bank statements shared with lenders | Privacy violation for workers |
| Platform earnings shared openly | Breach of DPDP Act principles |
| Transaction histories uploaded to fintech apps | Data aggregation and misuse risk |
| Centralized storage of income data | Single point of failure / breach |

### The scale of the problem

- **~1.2 crore** gig/platform workers in India (FY25, growing)
- **~40%** of small/informal earners are credit-constrained (World Bank)
- **10.9 crore** loans disbursed by fintechs in FY24-25 — yet most gig workers still excluded
- Fintechs have distribution, but lack **privacy-safe underwriting signals** for this segment

### The core tension

> Gig workers face a false choice: **financial access OR data privacy.** Acre eliminates that tradeoff.

---

## 2. Solution Overview

Acre is a **privacy-preserving income verification protocol** that allows gig workers to cryptographically prove their earning capacity — without exposing any raw financial data.

### What workers prove (without revealing)

```
monthly_income > ₹40,000          ✓ provable, source hidden
income_consistent_for_6_months    ✓ provable, transactions hidden
income_band = tier_2              ✓ provable, exact amount hidden
```

### What remains private

```
❌ Exact payment amounts
❌ Employer / platform names
❌ Transaction-level history
❌ Account balance
❌ Payer identities
```

### How it works in one line

Workers connect their income source → a ZK proof is generated locally → the proof (not the data) is submitted to an Algorand smart contract → lenders get a verified eligibility signal → loans are issued.

---

## 3. High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        Acre — High-Level View                       │
└─────────────────────────────────────────────────────────────────────────┘

   ┌──────────────┐     ┌───────────────────┐     ┌─────────────────────┐
   │  Web2 World  │     │   ZK Bridge Layer  │     │   Web3 / Algorand   │
   │              │     │                   │     │                     │
   │  Bank APIs   │────▶│  TLSNotary /      │────▶│  Smart Contract     │
   │  Uber API    │     │  zkTLS Attestation│     │  Income Verifier    │
   │  Razorpay    │     │                   │     │                     │
   │  Swiggy API  │     │  Noir ZK Circuits │────▶│  Credit Eligibility │
   │  Upwork API  │     │  (Client-side)    │     │  Engine             │
   └──────────────┘     └───────────────────┘     └──────────┬──────────┘
                                                             │
                                                             ▼
                                               ┌─────────────────────────┐
                                               │    Lending Protocol     │
                                               │                         │
                                               │  • Micro-loans (ASA)    │
                                               │  • BNPL                 │
                                               │  • DeFi Lending Pools   │
                                               │  • Fintech SDK          │
                                               └─────────────────────────┘
```

---

## 4. System Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Acre — System Architecture                        │
└─────────────────────────────────────────────────────────────────────────────┘

 LAYER 1: DATA ATTESTATION
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                          │
 │   Income Source          TLSNotary / zkTLS                               │
 │   ┌──────────┐           ┌──────────────────────────────────────┐        │
 │   │ Bank AA  │──────────▶│  Proves: "This API response came     │        │
 │   │ Uber API │           │  from authentic server X"            │        │
 │   │ Razorpay │           │                                      │        │
 │   │ Swiggy   │           │  Output: Signed attestation blob     │        │
 │   │ Upwork   │           │  (server identity + data hash)       │        │
 │   └──────────┘           └──────────────────────────────────────┘        │
 │                                            │                             │
 └────────────────────────────────────────────┼─────────────────────────────┘
                                              │ Attested data blob
                                              ▼
 LAYER 2: ZK PROOF GENERATION
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                          │
 │   Noir ZK Circuit (runs client-side / secure enclave)                    │
 │                                                                          │
 │   Private Inputs:              Public Outputs:                           │
 │   ┌──────────────────┐         ┌───────────────────────────────────┐     │
 │   │ • Raw income data│────────▶│ • income_above_threshold: true    │     │
 │   │ • Timestamps     │         │ • consistency_months: 6           │     │
 │   │ • Transaction IDs│         │ • income_band: tier_2             │     │
 │   │ • Platform tokens│         │ • proof_timestamp: <unix>         │     │
 │   └──────────────────┘         │ • source_hash: <hash>             │     │
 │                                └───────────────────────────────────┘     │
 │                                          │                               │
 │                              ZK Proof (~200 bytes)                       │
 └──────────────────────────────────────────┼─────────────────────────────-─┘
                                            │
                                            ▼
 LAYER 3: ALGORAND SMART CONTRACT
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                          │
 │   Income Verifier Contract (PyTeal / ARC-4)                              │
 │                                                                          │
 │   Verification Checks:              State Written On-Chain:              │
 │   ┌────────────────────────┐        ┌───────────────────────────────┐    │
 │   │ ✓ ZK proof validity    │───────▶│ income_verified: true         │    │
 │   │ ✓ Proof freshness      │        │ income_band: tier_2           │    │
 │   │   (not older than 90d) │        │ credit_limit: ₹50,000         │    │
 │   │ ✓ Source attestation   │        │ verified_at: <timestamp>      │    │
 │   │   signature valid      │        │ reputation_score: <int>       │    │
 │   └────────────────────────┘        └───────────────────────────────┘    │
 │                                                                          │
 └──────────────────────────────────────────┬───────────────────────────────┘
                                            │ Eligibility signal
                                            ▼
 LAYER 4: LENDING PROTOCOL
 ┌──────────────────────────────────────────────────────────────────────────┐
 │                                                                          │
 │   Lending Interface                     Settlement                       │
 │   ┌──────────────────────────┐          ┌────────────────────────────┐   │
 │   │ • Fintech SDK            │          │ Atomic Transfer Group:     │   │
 │   │ • NBFC integration       │─────────▶│  • Lock collateral (ASA)   │   │
 │   │ • DeFi lending pool      │          │  • Disburse loan (USDC/INR)│   │
 │   │ • BNPL provider          │          │  • Record repayment terms  │   │
 │   └──────────────────────────┘          └────────────────────────────┘   │
 │                                                                          │
 └──────────────────────────────────────────────────────────────────────────┘
```

---

## 5. User Journey Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        Acre — User Journey                               │
└─────────────────────────────────────────────────────────────────────────────┘

  WORKER                    APP                      BLOCKCHAIN              LENDER
    │                        │                           │                     │
    │  1. Connect income      │                           │                     │
    │─────────────────────▶  │                           │                     │
    │  (Bank AA / Uber API)   │                           │                     │
    │                        │                           │                     │
    │                        │  2. Fetch & attest data   │                     │
    │                        │  via TLSNotary            │                     │
    │                        │◀─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─▷│                     │
    │                        │  (server-signed blob)     │                     │
    │                        │                           │                     │
    │                        │  3. Generate ZK proof     │                     │
    │                        │  (Noir circuit, local)    │                     │
    │                        │  ┌─────────────────────┐  │                     │
    │                        │  │ Private: raw data   │  │                     │
    │                        │  │ Public: predicates  │  │                     │
    │                        │  └─────────────────────┘  │                     │
    │                        │                           │                     │
    │  4. Preview proof       │                           │                     │
    │◀────────────────────── │                           │                     │
    │  income_band: tier_2    │                           │                     │
    │  credit_limit: ₹50,000  │                           │                     │
    │  (no raw data shown)    │                           │                     │
    │                        │                           │                     │
    │  5. Approve & submit    │                           │                     │
    │─────────────────────▶  │                           │                     │
    │                        │  6. Submit proof to       │                     │
    │                        │  Algorand contract        │                     │
    │                        │──────────────────────────▶│                     │
    │                        │                           │                     │
    │                        │                           │  7. Verify proof     │
    │                        │                           │  • ZK validity       │
    │                        │                           │  • Freshness check   │
    │                        │                           │  • Source signature  │
    │                        │                           │                     │
    │                        │                           │  8. Write state      │
    │                        │                           │  income_verified=true│
    │                        │                           │  credit_limit=₹50k   │
    │                        │                           │                     │
    │                        │                           │  9. Emit event ─────▶│
    │                        │                           │                     │
    │                        │                           │        10. Lender    │
    │                        │                           │        reads signal  │
    │                        │                           │        issues loan   │
    │                        │                           │             │        │
    │  11. Loan disbursed     │                           │             │        │
    │◀────────────────────── │◀──────────────────────────│◀────────────┘        │
    │  ASA stablecoin loan    │  Atomic transfer settled  │                     │
    │                        │                           │                     │
    │  12. Repay loan         │                           │                     │
    │─────────────────────▶  │──────────────────────────▶│                     │
    │                        │  Update reputation score  │                     │
    │                        │                           │                     │
```

---

## 6. Core Components

### 6.1 Data Attestation Layer

Uses **TLSNotary / zkTLS** to prove that income data originated from a legitimate server — without revealing the content.

**Supported Sources:**

| Source | Type | Status |
|--------|------|--------|
| Bank Account (Account Aggregator) | Regulated API | ✅ Phase 1 |
| Razorpay / Stripe payouts | Payment processor | ✅ Phase 1 |
| Uber earnings dashboard | Platform API | 🔄 Phase 2 |
| Swiggy partner payouts | Platform API | 🔄 Phase 2 |
| Upwork payment history | Freelance platform | 🔄 Phase 2 |

**How attestation works:**
1. Worker initiates OAuth or AA consent
2. TLSNotary intercepts the TLS session and creates a notarized proof
3. Output: a signed blob containing `{server_identity, data_hash, timestamp}` — no raw content

---

### 6.2 ZK Proof Engine (Noir)

Circuits prove predicates over private income data.

**Circuit: `income_range.nr`**
```
// Simplified circuit logic
fn main(
    monthly_incomes: [Field; 6],   // private
    threshold: Field,               // public
    consistency_months: Field,      // public
) -> pub bool {
    let total = sum(monthly_incomes);
    let avg = total / 6;
    let consistent = count_above(monthly_incomes, threshold * 0.8);
    assert(avg > threshold);
    assert(consistent >= consistency_months);
    return true;
}
```

**Output:** A compact (~200 byte) proof with public signals:
```json
{
  "income_above_threshold": true,
  "income_band": 2,
  "consistency_months": 6,
  "proof_timestamp": 1735689600,
  "source_hash": "0xabc123..."
}
```

---

### 6.3 Algorand Smart Contract (PyTeal)

Verifies proofs and manages credit state on-chain.

**Contract: `income_verifier.py`**
```python
# Core verification logic (simplified)
@app.external
def verify_income_proof(
    proof: abi.DynamicBytes,
    public_signals: abi.DynamicBytes,
    source_attestation: abi.DynamicBytes,
) -> abi.Bool:
    # 1. Verify ZK proof against published verification key
    # 2. Check proof timestamp freshness (< 90 days)
    # 3. Validate source attestation signature
    # 4. Map income_band to credit tier
    # 5. Write verified state to app storage
    # 6. Emit verified event for lending protocols
```

**Global State Schema:**

| Key | Type | Description |
|-----|------|-------------|
| `income_verified` | bool | Verification status |
| `income_band` | uint | Tier 1 / 2 / 3 |
| `credit_limit` | uint | Max loan in paisa |
| `verified_at` | uint | Unix timestamp |
| `reputation_score` | uint | Repayment track record |

**Credit Tiers:**

| Tier | Monthly Income | Credit Limit |
|------|---------------|--------------|
| Tier 1 | > ₹25,000 | ₹25,000 |
| Tier 2 | > ₹40,000 | ₹50,000 |
| Tier 3 | > ₹70,000 | ₹1,00,000 |

---

### 6.4 Lending Interface

Fintech platforms integrate via the **Acre SDK**.

```typescript
// SDK usage example
import { Acre } from '@Acre/sdk';

const client = new Acre({ network: 'algorand-mainnet' });

// Check worker eligibility
const eligibility = await client.getEligibility(workerWalletAddress);
// Returns: { verified: true, creditLimit: 50000, band: 'tier_2' }

// Issue loan using ASA
const loan = await client.issueLoan({
  borrower: workerWalletAddress,
  amount: 30000,
  currency: 'USDC',
  termDays: 30,
});
```

**Atomic Transfer ensures:**
- Collateral locked + loan disbursed in one transaction group
- No partial execution possible
- Settlement is deterministic and instant

---

## 7. Why Algorand

| Property | Benefit for Acre |
|----------|---------------------|
| **Deterministic Execution** | Credit rules behave identically every time — no ordering surprises |
| **Low Fees (~0.001 ALGO)** | Microloan issuance is economically viable at any ticket size |
| **Atomic Transfers** | Collateral locking + loan disbursement in a single transaction group |
| **Algorand Standard Assets (ASA)** | Native stablecoin support for loan currency (USDC, INR-pegged) |
| **Fast Finality (< 4 seconds)** | Workers get loan confirmation near-instantly |
| **ARC-4 ABI** | Clean SDK integration for fintech partners |
| **Algorand Indexer** | Audit trails for regulatory reporting without exposing individual data |

---

## 8. Privacy & Compliance (DPDP Act)

Acre is designed from the ground up to align with India's **Digital Personal Data Protection (DPDP) Act, 2023**.

| DPDP Principle | Acre Implementation |
|----------------|------------------------|
| **Data Minimization** | Only income predicates (true/false conditions) are revealed — never raw transactions |
| **Purpose Limitation** | Data used exclusively for credit eligibility; ZK circuit enforces scope |
| **Storage Limitation** | No raw financial data stored anywhere in the system |
| **Consent-based** | Worker explicitly approves proof generation and submission |
| **Verifiability** | Cryptographic proofs provide tamper-proof audit trails |
| **Right to Erasure** | On-chain state can be nullified; off-chain data never stored |

**Regulatory audit trail:**
- Algorand Indexer provides immutable event logs
- Logs contain only proof hashes and eligibility outcomes — no PII
- Suitable for RBI / fintech regulator reporting

---

## 9. ZK Circuit Design

```
┌──────────────────────────────────────────────────────────────────┐
│                    Noir Circuit: income_range                     │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  PRIVATE INPUTS              COMPUTATION           PUBLIC OUTPUT │
│  ┌──────────────┐            ┌──────────┐          ┌──────────┐  │
│  │ income[0..5] │───────────▶│ avg()    │─────────▶│ band: 2  │  │
│  │ (6 months)   │            │ sum()    │          │          │  │
│  │              │            │ count()  │          │ above_   │  │
│  │ timestamps   │───────────▶│ window() │─────────▶│threshold │  │
│  │ [0..5]       │            │          │          │ = true   │  │
│  │              │            │ range    │          │          │  │
│  │ source_sig   │───────────▶│ check()  │─────────▶│ source   │  │
│  │              │            │          │          │ valid    │  │
│  └──────────────┘            └──────────┘          └──────────┘  │
│                                                                  │
│  Proof size: ~200 bytes                                          │
│  Verification cost: < 0.001 ALGO                                 │
│  Generation time: < 2 seconds (client-side)                      │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

---

## 10. Smart Contract Logic

```
┌──────────────────────────────────────────────────────────────────────────┐
│               Income Verifier — Contract State Machine                    │
└──────────────────────────────────────────────────────────────────────────┘

  [Unverified]
       │
       │  verify_income_proof(proof, signals, attestation)
       ▼
  ┌──────────────────────────────────────┐
  │ Check 1: ZK proof valid?             │──── FAIL ──▶ [Rejected]
  │          (verify against vkey)       │
  └──────────────────────────────────────┘
       │ PASS
       ▼
  ┌──────────────────────────────────────┐
  │ Check 2: Proof fresh?                │──── FAIL ──▶ [Expired]
  │          (timestamp < 90 days)       │
  └──────────────────────────────────────┘
       │ PASS
       ▼
  ┌──────────────────────────────────────┐
  │ Check 3: Source attestation valid?   │──── FAIL ──▶ [Untrusted Source]
  │          (TLSNotary signature check) │
  └──────────────────────────────────────┘
       │ PASS
       ▼
  ┌──────────────────────────────────────┐
  │ Map income_band → credit_tier        │
  │ Write state to app storage           │
  │ Emit IncomeVerified event            │
  └──────────────────────────────────────┘
       │
       ▼
  [Verified]
       │
       │  Lending protocol reads state
       │  Issues loan via atomic transfer
       ▼
  [Loan Active]
       │
       │  Repayment recorded
       ▼
  [Reputation Updated]
```

---

## 11. Demo Flow

### Prerequisites
- Algorand wallet (Pera / Defly)
- Test bank statement or simulated API response
- Local Algorand node or Testnet access

### Step-by-Step

**Step 1 — Connect income source**
```bash
cd demo/
python connect_income_source.py --source bank_statement --file sample_statement.pdf
```
Output: `attestation_blob.json`

**Step 2 — Generate ZK proof**
```bash
cd circuits/
nargo prove --input attestation_blob.json --threshold 40000 --months 6
```
Output: `proof.json` + `public_signals.json`

**Step 3 — Submit to Algorand**
```bash
cd contracts/
python submit_proof.py --proof proof.json --signals public_signals.json --network testnet
```
Output: Transaction ID + on-chain state

**Step 4 — Verify eligibility**
```bash
python check_eligibility.py --wallet <your_wallet_address>
```
Output:
```json
{
  "income_verified": true,
  "income_band": "tier_2",
  "credit_limit": 50000,
  "verified_at": "2025-01-01T00:00:00Z"
}
```

**Step 5 — Issue test loan**
```bash
python issue_loan.py --borrower <wallet> --amount 30000 --currency USDC
```
Output: Atomic transfer group TX ID + loan disbursed

---

## 12. Project Structure

```
acre/
│
├── circuits/                        # Noir ZK circuits
│   ├── income_range.nr              # Core income range prover
│   ├── consistency_check.nr         # Consistency over N months
│   └── Nargo.toml
│
├── contracts/                       # Algorand smart contracts
│   ├── income_verifier.py           # PyTeal: main verification contract
│   ├── lending_pool.py              # PyTeal: loan issuance and settlement
│   ├── reputation_tracker.py        # PyTeal: on-chain credit history
│   └── deploy.py
│
├── attestation/                     # Data attestation layer
│   ├── tlsnotary_client.ts          # TLSNotary integration
│   ├── bank_connector.ts            # Account Aggregator connector
│   └── platform_connectors/
│       ├── razorpay.ts
│       └── stripe.ts
│
├── sdk/                             # Fintech integration SDK
│   ├── verification_client.ts       # Main SDK entry point
│   ├── types.ts
│   └── examples/
│       └── basic_integration.ts
│
├── demo/                            # Demo scripts and sample data
│   ├── connect_income_source.py
│   ├── check_eligibility.py
│   ├── issue_loan.py
│   └── sample_data/
│       └── sample_statement.json
│
├── tests/
│   ├── circuit_tests/
│   ├── contract_tests/
│   └── integration_tests/
│
├── docs/
│   └── architecture.md
│
├── requirements.txt
├── package.json
└── README.md
```

---

## 13. Setup & Installation

### Prerequisites

```bash
# Algorand tooling
pip install algokit --break-system-packages
pip install pyteal --break-system-packages

# Noir (ZK circuit compiler)
curl -L https://raw.githubusercontent.com/noir-lang/noirup/main/install | bash
noirup

# Node.js (for SDK and attestation layer)
npm install
```

### Clone and configure

```bash
git clone https://github.com/somehowliving/acre
cd acre

pip install -r requirements.txt
cp .env.example .env
# Edit .env: set ALGORAND_NETWORK, ALGOD_TOKEN, etc.
```

### Compile ZK circuits

```bash
cd circuits/
nargo build
nargo test
```

### Deploy smart contracts

```bash
cd contracts/
algokit deploy --network testnet
```

### Run the demo

```bash
cd demo/
python run_demo.py --mode full
```

---

## 14. Use Cases

### Gig Worker Microloans
A Swiggy delivery partner with 8 months of consistent ₹35,000/month earnings generates a ZK proof, submits it, and receives a ₹25,000 working capital loan — without ever sharing a bank statement with the lender.

### Freelancer Credit Lines
An Upwork freelancer with variable but above-threshold earnings proves income consistency and accesses a rolling credit line for equipment purchases.

### Privacy-Preserving BNPL
A fintech app integrates the Acre SDK to offer BNPL to gig workers at checkout — eligibility verified in seconds, no document upload required.

### Decentralized Lending Pools
DeFi lending protocols on Algorand use the verified income signal as an undercollateralized loan signal, expanding access beyond crypto-native users.

---

## 15. Roadmap

| Phase | Timeline | Milestone |
|-------|----------|-----------|
| **Phase 1 — Hackathon MVP** | Current | Bank AA connector, Noir circuit, Algorand contract, basic demo |
| **Phase 2 — Platform APIs** | Month 1–2 | Uber, Swiggy, Razorpay connectors; SDK alpha |
| **Phase 3 — Pilot** | Month 3–4 | Integration with 1 NBFC/fintech partner; 100 test users |
| **Phase 4 — Scale** | Month 5–6 | Decentralized lending pool; reputation scoring; RBI sandbox |
| **Phase 5 — Ecosystem** | Month 7–12 | Multi-chain support; insurance use case; credit bureau integration |

---

## 16. References

1. NITI Aayog — *India's Booming Gig and Platform Economy* (2022)
2. World Bank — *SME Finance Overview: Credit Constraints in Emerging Markets*
3. MSME Annual Report 2024–25 — Ministry of MSME, Government of India
4. SIDBI — *MSME Sector Report 2024–25*
5. RBI — *Account Aggregator Framework Documentation*
6. Digital Personal Data Protection Act, 2023 — Ministry of Electronics and IT
7. TLSNotary — *Privacy-Preserving Data Provenance from Web2 Sources*, tlsnotary.org
8. Noir Language Documentation — noir-lang.org
9. Algorand Developer Documentation — developer.algorand.org
10. LiveMint / Economic Survey coverage — Gig worker credit access (2025–26)

---

## 17. Team

**Team:** [zkFarmers]

| Member | Role |
|--------|------|
| Nidhi Prajapati | Blockchain & ZK Engineer |

---

### Track Alignment

| Track | How Acre Fits |
|-------|------------------|
| **Future of Finance** | Privacy-preserving lending infrastructure for India's gig economy |
| **DPDP & RegTech** | Built-in DPDP Act compliance via data minimization and ZK proofs |

---

> *"Acre doesn't ask gig workers to choose between privacy and financial access. It proves they never had to."*

---

**AlgoBharat Hack Series 3.0** · Built with ♥ for India's 1.2 crore gig workers
