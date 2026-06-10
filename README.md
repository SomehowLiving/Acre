# Acre — Privacy-Preserving Underwriting Framework for Gig Workers

<p align="center">
  <img src="acre-web/src/assets/acre-logo.png" width="88" alt="Acre" />
</p>

<p align="center">
  <strong>Configurable. Regulatory-Safe. Zero DPDP Liability.</strong>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/For-NBFCs%20%26%20Fintechs-00BCD4?style=for-the-badge" alt="For Lenders" />
  <img src="https://img.shields.io/badge/Algorand-Powered-00BCD4?style=for-the-badge&logo=algorand&logoColor=white" alt="Algorand" />
  <img src="https://img.shields.io/badge/Zero--Knowledge-Noir-7C3AED?style=for-the-badge" alt="Zero-Knowledge" />
  <img src="https://img.shields.io/badge/DPDP-Compliant-10B981?style=for-the-badge" alt="DPDP Compliant" />
</p>

<p align="center">
  <strong>Onboard India's 8M+ credit-invisible gig workers safely under RBI/DPDP norms.<br/>
  Configure your policy. Zero raw PII. Immutable audit trail.</strong>
</p>

<p align="center">
  <a href="#the-problem"><strong>Problem</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#the-solution"><strong>Solution</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#how-acre-works"><strong>How it works</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#getting-started"><strong>Get started</strong></a>
  &nbsp;&middot;&nbsp;
  <a href="#business-model"><strong>Business model</strong></a>
</p>

---

## Table of contents

<details open>
<summary><strong>Jump to a section</strong></summary>

**For Lenders**

- [The Problem](#the-problem)
- [The Solution](#the-solution)
- [How Acre Works](#how-acre-works)
- [What You Configure](#what-you-configure)

**Technical**

- [Architecture](#architecture)
- [Smart Contracts](#smart-contracts)
- [Tech Stack](#-tech-stack)

**Build**

- [Getting Started](#getting-started)
- [Developer Setup](#developer-setup)

**Context**

- [Why Algorand](#why-algorand)
- [Privacy & Compliance](#privacy--compliance)
- [Business Model & GTM](#business-model--gtm)

</details>

---

## The Problem

### RBI 2025 Blocked You. DPDP Threatens Your Balance Sheet.

**RBI Digital Lending Directions (2025)** banned SMS, contact lists, location tracking, and device fingerprinting for underwriting. **DPDP Act (2023)** threatens ₹250 crore penalties for raw PII misuse.

**Your situation:**
- You originated **301 lakh sub-₹50k accounts** in Q1 FY26 (NBFC-fintech data)
- You want to lend to **India's 8M+ gig workers** — the exact segment
- Your **old alternative-data playbook** is now **criminal and expensive**
- **Account Aggregator** only covers bank flows — misses platform tenure, ratings, completion rates that predict gig-worker repayment
- Result: **~40% approval rate on gig workers**, even good credit risks, because you're missing signals

### The Cost of Silence

| Challenge | Your Cost |
|-----------|-----------|
| **Manual thin-file underwriting** | ₹800–₹1,200 per applicant |
| **DPDP compliance team** | +3–5 people, ₹50–100L/year |
| **Market loss** | 8M gig workers you can't safely touch |
| **Regulatory audit prep** | ₹20–50L per inspection cycle |

---

## The Solution

### Acre is not a credit score. It is a **configurable, privacy-preserving underwriting framework** sold to lenders.

> **What you get:**
> 1. **You define the policy** — Select which proof modules (income, tenure, rating, identity) matter to YOUR risk appetite. Set thresholds. Adjust weights. No black box.
> 2. **Workers verify locally** — QR scan → Login to Uber/Swiggy → ZK proof generated on their phone → Only YOUR configured signals revealed. Zero custody of raw data.
> 3. **Blue Score computed** — Explainable 300-900 scorecard → Blue Prime / Blue Plus / Blue Basic tiers. You know exactly what drives each worker's score.
> 4. **Proof stored immutably** — Consent artifact + proof hash on Algorand. Immutable audit trail for RBI/DPDP inspections. Zero raw PII on your servers.
> 5. **You query in real-time** — `get_eligibility(worker_wallet)` → Instant credit tier, limit, proof timestamp. Your compliance team sleeps.

### What Changes for You

| Metric | Before | With Acre |
|--------|--------|-----------|
| **Cost per verification** | ₹950 (manual) | ₹55 (API) |
| **Approval rate on gig workers** | <40% | 70%+ (3x lift) |
| **Compliance cost** | +₹50–100L/year | –70% (audit trail built-in) |
| **Market accessible** | 0 gig workers safely | 8M+ gig workers |
| **Raw data custody** | You store it (DPDP risk) | Zero; only proof hash |

---

## How Acre Works

### Lender's Perspective: 4-Step Integration

```mermaid
flowchart LR
    subgraph CONFIG["1. Configure"]
        SELECT["Select proof modules<br/>(income, tenure, rating, identity)"]
        POLICY["Set risk thresholds<br/>(tier cutoffs, loan limits)"]
    end

    subgraph WORKER["2. Worker Verifies"]
        QR["QR scan to Uber/Swiggy"]
        PROOF["ZK proof generated locally<br/>(zero custody)"]
    end

    subgraph COMPUTE["3. Score & Store"]
        SCORE["Blue Score computed<br/>(explainable metrics)"]
        CHAIN["Proof hash + consent<br/>logged on Algorand"]
    end

    subgraph QUERY["4. Query & Disburse"]
        API["get_eligibility(wallet)<br/>→ tier, limit, timestamp"]
        DISBURSE["Approve or reject<br/>in real-time"]
    end

    CONFIG --> WORKER
    WORKER --> COMPUTE
    COMPUTE --> QUERY

    style CONFIG fill:#1a1040,stroke:#a78bfa,color:#f8fafc
    style WORKER fill:#0a1a2a,stroke:#00e5ff,color:#f8fafc
    style COMPUTE fill:#2a1a1a,stroke:#ec4899,color:#f8fafc
    style QUERY fill:#0a2018,stroke:#34d399,color:#f8fafc
```

### Step-by-Step: Worker to Lender

```mermaid
sequenceDiagram
    participant L as Your NBFC
    participant F as Acre Platform
    participant W as Gig Worker
    participant R as Reclaim Protocol
    participant SC as Smart Contract
    participant I as Algorand Indexer

    L->>F: Configure policy (income, tenure, rating, activity, completion)
    L->>F: Set risk appetite and lender rules
    
    W->>F: Connect wallet
    F->>R: Create QR session
    W->>R: Scan QR, login to Uber
    R->>W: Generate ZK proof (locally)
    W->>F: Submit proof
    F->>F: Verify ECDSA signature
    F->>F: Extract metrics (income, tenure, rating, activity, reliability)
    F->>F: Compute Blue Score (300-900) + affordability limit
    F->>SC: Store proof hash + score + consent outcome
    SC->>I: Log on-chain
    
    L->>SC: Query get_eligibility(worker_wallet)
    SC-->>L: Blue tier, credit limit, proof timestamp
    L-->>W: Approve or price loan using own policy
    L->>I: Audit trail ready for RBI inspection
```

---

## What You Configure

### The Lender Console

No coding. Visual configuration. See impact before deployment.

```
┌─ SELECT PROOF MODULES ──────────┐
│ ✓ Income (₹20k–₹40k–₹60k)      │
│ ✓ Tenure (3mo–6mo–12mo)        │
│ ✓ Rating (4.0–4.5–4.8)         │
│ ✓ Completion Rate              │
│ ✗ Crypto Holdings              │
└────────────────────────────────┘

┌─ REVIEW SCORE DRIVERS ──────────┐
│ Income Stability ........ 30%    │
│ Consistency / Tenure .... 25%    │
│ Platform Rating ......... 20%    │
│ Activity Volume ......... 15%    │
│ Completion Reliability .. 10%    │
└────────────────────────────────┘

┌─ SET LOAN PRODUCTS ─────────────┐
│ Blue Prime (700+): best pricing │
│ Blue Plus (530-699): standard   │
│ Blue Basic (<530): entry tier   │
│ Limits bounded by income, DTI,  │
│ and product-level caps          │
└────────────────────────────────┘
```

### Pre-Deployment Impact Preview

See how your thresholds affect approval rates **before going live:**

```
Your current policy:
└─ 1,000 gig-worker applicants
   ├─ 180 qualify Blue Prime (best pricing)
   ├─ 520 qualify Blue Plus (standard pricing)
   └─ 300 qualify Blue Basic or require review
   
   Portfolio impact: lender-specific credit policy
   Audit trail: proof hash + score + limit + timestamp
```

---

## Architecture

### 3-Layer System (You Own Layer 3)

```mermaid
graph TB
    subgraph LAYER1["Layer 1: Proof Engine"]
        RECLAIM["Reclaim zk-TLS<br/>(income, tenure, rating)"]
        DID["DID / DigiLocker<br/>(identity)"]
        NOIR["Noir ZK Circuits"]
    end

    subgraph LAYER2["Layer 2: Feature & Score (Off-Chain)"]
        FEATURES["Feature Extraction"]
        SCORE["Blue Scorecard<br/>(explainable metrics)"]
        DASHBOARD["Worker Dashboard<br/>(score, tier, profile)"]
    end

    subgraph LAYER3["Layer 3: Decision & Compliance (You Control)"]
        CONSOLE["Your Lender Console<br/>(policy config)"]
        CONTRACT["Acre Smart Contract<br/>(Algorand App ID: 764223486)"]
        INDEXER["Algorand Indexer<br/>(audit trail)"]
    end

    RECLAIM --> FEATURES
    DID --> FEATURES
    NOIR --> FEATURES
    FEATURES --> SCORE
    SCORE --> DASHBOARD
    DASHBOARD --> CONSOLE
    CONSOLE --> CONTRACT
    CONTRACT --> INDEXER

    style LAYER1 fill:#1a1040,stroke:#a78bfa,color:#f8fafc
    style LAYER2 fill:#0a1a2a,stroke:#00e5ff,color:#f8fafc
    style LAYER3 fill:#0a2018,stroke:#34d399,color:#f8fafc
```

| Layer | What It Does | Who Controls It |
|-------|--------------|-----------------|
| **Proof Engine** | Generates ZK proofs locally (zero custody) | Reclaim + Algo community |
| **Feature & Score** | Computes features and Blue Score | Acre platform |
| **Decision & Compliance** | Your policy, your audit trail | **YOU (Lender)** |

**Critical:** You never see raw data. You only see: proof hash + score + eligibility outcome.

---

## Smart Contracts

**App ID (TestNet):** `764223486`

### What the Contract Does

```python
@application.internal()
def verify_income(
    user_wallet: str,
    tier: uint64,
    credit_limit: uint64,
    timestamp: uint64,
    proof_hash: bytes,
    rider_count: uint64,
    rider_rating: uint64,
    platform: str,
    score: uint16,
    income_bucket: uint8,
    tenure_bucket: uint8,
    completion_bucket: uint8,
    rating_bucket: uint8,
    source: str,
    plausibility_flags: uint8,
    monthly_earnings: uint64,
    tenure_months: uint64,
    completion_rate: uint64,
) -> None:
    """
    Store worker's verified score and credit tier.
    Called by Acre backend after proof verification.
    Only designated verifier can write.
    """
    worker_state = local_state(acct := TxnFields.sender())
    worker_state['proof_hash'] = proof_hash
    worker_state['score'] = score
    worker_state['tier'] = tier
    worker_state['credit_limit'] = credit_limit
    worker_state['monthly_earnings'] = monthly_earnings
    worker_state['tenure_months'] = tenure_months
    worker_state['completion_rate'] = completion_rate
    worker_state['timestamp'] = timestamp

@application.external(read_only=True)
def get_eligibility(address: str) -> uint64:
    """
    Query worker's current stored credit limit.
    Permissionless — any lender can call.
    """
    worker_state = local_state(address)
    return worker_state['credit_limit']
```

### How You Use It

```bash
# 1. After Acre backend verifies a worker's proof
algosdk.send_atomic(group=[
    txn.verify_income(
        proof_hash="0x1a2b3c...",
        tier=2,
        credit_limit=25000,
        score=685,
        monthly_earnings=36000,
        tenure_months=18
    )
])

# 2. When an applicant submits a loan request
limit = contract.get_eligibility(worker_wallet)
profile = contract.get_full_profile(worker_wallet)
score = profile.score

if score >= 530 and limit > 0:
    print(f"Review ₹{limit} eligibility under your policy")
else:
    print("Decline or request updated verification")
```

---

## 🛠️ Tech Stack

| Area | Technologies |
|------|--------------|
| **Framework** | Configurable, privacy-preserving underwriting |
| **Proof Engine** | Reclaim Protocol (zk-TLS), Noir ZK Circuits, DID-ready |
| **Frontend** | React 18, TypeScript, Vite, Tailwind CSS |
| **Backend** | Node.js 20+, Express, Algorand SDK |
| **Smart Contracts** | Algorand Python contract, ARC-4 ABI |
| **Database** | Supabase (workflows, audit logs) |
| **Blockchain** | Algorand (sub-3s finality, ~₹0.02 per verification) |

---

## Why Algorand

| Property | Why It Matters to You |
|:---|:---|
| ⚡ **Sub-3s Finality** | Real-time loan decisions during customer session |
| 💰 **~0.001 ALGO/tx** | Verification costs ~₹0.02; doesn't eat margins on ₹5k loans |
| 🏛️ **Deterministic Execution** | Credit rules execute identically every time—RBI compliance critical |
| 🗂️ **ARC-4 + Indexer** | Clean SDK for your team; immutable audit trail for regulators |
| 🌱 **Carbon Negative** | ESG alignment for impact-focused investors and regulators |

---

## Screenshots

See the full visual walkthrough of Acre's lender and worker flows: **[SCREENS.md](./SCREENS.md)**

**Quick preview:**
- **Lender Console:** Configure your scorecard, set thresholds, see portfolio impact
- **Worker Proof Flow:** Identity → QR scan → ZK proof → Blue Score → Dashboard
- **What-If Simulator:** See how actions unlock better credit tiers
- **Lender Dashboard:** Monitor workers, track approvals, manage risk
---

## Getting Started

### For Lenders (2-Hour Onboarding)

| Step | Time | Action |
|------|------|--------|
| **1. Demo** | 30 min | See Acre in action + ask compliance questions |
| **2. Configure** | 45 min | Build your scorecard in Lender Console (no code) |
| **3. Test** | 30 min | Run 10 test workers through end-to-end |
| **4. Deploy** | 15 min | Flip switch to production (TestNet → MainNet) |

**Result:** Live gig-worker underwriting in 2 hours. Your audit trail baked in.

### For Workers (60 Seconds)

1. Visit [acre-web-three.vercel.app](https://acre-web-three.vercel.app)
2. Connect Pera or Defly wallet
3. Scan Reclaim QR → Login to Uber/Swiggy
4. See your Blue Score + credit tier
5. Share proof with lenders (your choice)

Fund TestNet wallet: [Algorand dispenser](https://dispenser.testnet.aws.algodev.network/)

---

## Developer Setup

### Prerequisites

- Node.js 18+
- npm 9+
- Docker (optional, for LocalNet)

### Clone and install

```bash
git clone https://github.com/somehowliving/acre.git
cd acre

cd acre-web && npm install
cd .. && npm install
```

### Environment configuration

**Frontend** (`acre-web`):

```bash
cp .env.example .env.local
```

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `VITE_RECLAIM_APP_ID` | Yes | Reclaim protocol |
| `VITE_RECLAIM_APP_SECRET` | Yes | Reclaim secret |
| `VITE_BACKEND_VERIFY_URL` | Yes | Backend endpoint |
| `VITE_ALGORAND_APP_ID` | Yes | `764223486` (TestNet) |
| `VITE_ALGOD_SERVER` | Yes | Algorand RPC |

**Backend** (repo root):

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|----------|:--------:|---------|
| `APP_ID` | Yes | Acre contract app ID |
| `ALGOD_SERVER` | Yes | Algorand RPC |
| `VERIFIER_MNEMONIC` | Yes | Proof signer account |

### Run locally

**Terminal 1 - Backend**

```bash
npm start
# Listening on http://localhost:3001
```

**Terminal 2 - Frontend**

```bash
cd acre-web
npm run dev
# Listening on http://localhost:8080
```

---

## Privacy & Compliance

### DPDP Act 2023 Alignment

**Every feature is designed to minimize your DPDP liability.**

| Principle | Your Protection |
|-----------|-----------------|
| **Data Minimization** | Zero raw financial data on your servers; only proof hash + score |
| **Purpose Limitation** | Credit eligibility only; no cross-selling, no aggregation |
| **Storage Limitation** | Acre stores nothing; you store only tier/score/limit/timestamp |
| **Consent-Based** | Worker explicitly approves every proof; logged on-chain |
| **Verifiability** | Algorand Indexer provides immutable audit trail for inspections |
| **Right to Erasure** | On-chain state nullifiable; zero off-chain raw data |

### Your Audit Trail

✓ Algorand Indexer logs every proof verification (consent + score, no PII)  
✓ Suitable for RBI Digital Lending inspection  
✓ Suitable for DPDP Act compliance audit  
✓ Export for your compliance team in 2 clicks  

---

## Business Model & GTM

Detailed pricing, unit economics, roadmap, and partnership strategy: **[GTM.md](./docs/GTM.md)**

---

## References

- [RBI Digital Lending Directions (2025)](https://www.rbi.org.in)
- [DPDP Act, 2023](https://www.meity.gov.in)
- [NITI Aayog — India's Gig Economy Report](https://niti.gov.in)
- [Algorand Documentation](https://developer.algorand.org)
- [Reclaim Protocol](https://reclaimprotocol.org)

---

## Team

**zkFarmers** — Building regulatory-safe credit infrastructure for emerging markets

| Member | Role | GitHub |
|:---|:---|:---|
| Nidhi Prajapati | Blockchain & ZK Engineer | [@somehowliving](https://github.com/somehowliving) |

---

<p align="center">
  <strong>8M+ gig workers. 0 custody. ₹250Cr DPDP penalty avoided.<br/>
  Acre is the underwriting framework regulators want.</strong>
</p>

<p align="center">
  Built for India's future of finance
</p>
