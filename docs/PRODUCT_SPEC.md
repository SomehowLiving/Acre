# Acre Protocol MVP - Corrected Implementation Guide

## 📋 Table of Contents
1. [What Acre Actually Is](#what-acre-actually-is)
2. [Architecture Overview](#architecture-overview)
3. [Scope Clarity](#scope-clarity)
4. [MVP Timeline](#mvp-timeline)
5. [Code Implementation](#code-implementation)
6. [Deployment](#deployment)

---

## What Acre Actually Is

### The Simple Definition
**Acre is a privacy-preserving income verification infrastructure, NOT a lending platform.**

Think of Acre like CIBIL or Experian (credit bureaus) — but using Zero-Knowledge Proofs instead of storing raw financial data.

```
What Acre Does:
1. Worker submits ZK proof of income (via Reclaim)
2. Acre verifies the proof signature
3. Acre stores: "This worker is verified as Tier 2"
4. Acre provides query API: "Is wallet 0xABC... eligible?"

What Acre Does NOT Do:
❌ Issue loans
❌ Track repayments
❌ Manage collateral
❌ Store raw income data
❌ Run a lending app
❌ Calculate interest
```

### The Ecosystem

```
┌──────────────────────────────────────────────────────────────┐
│            GIG WORKER / FREELANCER (User)                   │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 1. Opens Acre dApp                                     │ │
│  │ 2. Clicks "Verify Income"                              │ │
│  │ 3. Scans QR → Logs into Uber (via Reclaim)            │ │
│  │ 4. Gets ZK proof                                       │ │
│  │ 5. Submits to Acre Smart Contract                      │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                            ▼
┌──────────────────────────────────────────────────────────────┐
│           ACRE PROTOCOL (What WE Build)                     │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ Smart Contract:                                        │ │
│  │ • verify_income(proof) → Stores verification           │ │
│  │ • get_eligibility(wallet) → Returns tier/limit         │ │
│  │                                                        │ │
│  │ Frontend:                                              │ │
│  │ • Worker UI to submit proofs                          │ │
│  │                                                        │ │
│  │ SDK:                                                   │ │
│  │ • Lender API to query eligibility                     │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
                            ▼ (Queries)
┌──────────────────────────────────────────────────────────────┐
│          LENDERS / DeFi / NBFCs (Acre's Customers)           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │ 1. User applies for loan in lender's app              │ │
│  │ 2. Lender queries Acre: "Is this wallet eligible?"    │ │
│  │ 3. Acre responds: "Yes, Tier 2, Limit ₹50,000"        │ │
│  │ 4. Lender issues loan - THEIR JOB, NOT ACRE'S         │ │
│  │ 5. Lender tracks repayment - THEIR JOB, NOT ACRE'S    │ │
│  └────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────┘
```

### Responsibilities Matrix

| Component | Owner |
|-----------|-------|
| Income Verification | **Acre** |
| Proof Generation | Reclaim Protocol |
| Loan Issuance | Lenders (NBFC/Bank/DeFi) |
| Loan Repayment Tracking | Lenders (NBFC/Bank/DeFi) |
| Interest Calculation | Lenders |
| Collateral Management | Lenders |
| Dispute Resolution | Lenders |

**Acre's Only Job**: Verify income proof → Store verification on-chain → Provide query API

---

## Architecture Overview

### The Data Flow

```
1. WORKER INITIATES
   Opens Acre dApp
   Clicks: "Verify Income"
   ↓

2. RECLAIM PROTOCOL (External Service)
   Frontend calls: ReclaimProofRequest.init('APP_ID', 'SECRET', 'uber-driver-earnings')
   Returns: QR code + session URL
   ↓

3. WORKER SCANS & LOGS IN
   Scans QR with phone
   Opens Reclaim app
   Logs into Uber (securely via OAuth)
   Reclaim witnesses TLS session (can't decrypt)
   ↓

4. RECLAIM GENERATES PROOF
   Worker's device extracts data: "monthly_earnings: 45230"
   Worker's device generates ZK proof locally
   Proof proves: "Income > ₹25,000 AND < ₹50,000"
   But NOT: "Income = ₹45,230"
   ↓

5. PROOF SENT TO ACRE FRONTEND
   Proof arrives: { claimData, signatures, publicSignals }
   Frontend submits to your backend
   ↓

6. YOUR BACKEND VERIFIES
   Calls: Reclaim.verifyProof(proof)
   ✓ Signature is valid
   Extract: income_band = 2
   ↓

7. SUBMITS TO ALGORAND
   Calls smart contract: verify_income(proof, publicSignals, wallet)
   ↓

8. SMART CONTRACT STORES
   Verifies tier is valid (1-3)
   Maps tier to credit limit (1→10k, 2→50k, 3→150k)
   Stores on-chain:
     - verified: true
     - tier: 2
     - limit: 50000
     - timestamp: now
     - proof_hash: sha256(proof)
   ↓

9. FRONTEND SHOWS RESULT
   Worker sees: "✓ Verified as Tier 2"
   "Credit Limit: ₹50,000"
   "Share your wallet with lenders to apply for loans"
   ↓

10. LENDER QUERIES ACRE
    Lender's app (or SDK): acre.getEligibility(workerWallet)
    Acre returns: { verified: true, tier: 2, limit: 50000 }
    Lender decides: "We'll offer a ₹30,000 loan"
    Lender issues loan (using their own capital, logic, system)
    ↓

11. LENDER TRACKS REPAYMENT
    Lender's system tracks: When payment made, how much, due date
    Acre is NOT involved in repayment
    ↓

12. WORKER CAN RE-VERIFY
    Income changes after 6 months
    Worker runs verification again
    Acre stores new tier (might be higher or lower)
    Lenders can query for updated eligibility
```

---

## Scope Clarity

### ❌ WE Are NOT Building

- **TLSNotary Infrastructure**: Reclaim handles this
- **ZK Circuits**: Reclaim handles this
- **Browser Extensions**: Reclaim handles this
- **Attestor Network**: Reclaim handles this
- **Lending Logic**: Lenders build this themselves
- **Repayment Tracking**: Lenders build this themselves
- **Complex Reputation System**: Start simple

### ✅ WE ARE Building

1. **Frontend (React)**
   - "Verify Income" button
   - QR code display
   - Proof status UI
   - Result display

2. **Backend (Node.js)**
   - Receive Reclaim proof
   - Verify Reclaim.verifyProof()
   - Extract tier from public signals
   - Call smart contract

3. **Smart Contract (PyTeal)**
   - `verify_income()` - Store verification
   - `get_eligibility()` - Query API

4. **Lender SDK (TypeScript)**
   - Query function for lenders
   - Return eligibility data

---

## MVP Timeline

### Day 1: Frontend + Backend (8 hours)

```
Goal: User can verify income end-to-end

Timeline:
- 1 hour: React setup + Reclaim SDK
- 2 hours: QR code + proof callback
- 2 hours: Backend route to verify proof
- 2 hours: Test & debugging
- 1 hour: Buffer
```

**Deliverable**: Proof arrives at backend, verified

### Day 2: Smart Contract (8 hours)

```
Goal: Contract deployed, can store verification

Timeline:
- 2 hours: PyTeal setup + environment
- 2 hours: Write both methods (verify_income + get_eligibility)
- 2 hours: Local testing
- 1 hour: Deploy to Testnet
- 1 hour: Verify on-chain data
```

**Deliverable**: Contract on testnet, methods work

### Day 3: Integration + Polish (8 hours)

```
Goal: Complete flow, ready to demo

Timeline:
- 2 hours: Connect frontend to contract
- 2 hours: Write Lender SDK
- 2 hours: UI polish + error handling
- 1 hour: End-to-end testing
- 1 hour: Demo prep
```

**Deliverable**: Demo ready (QR → contract → "Verified!")

---


## Demo Script

```
[Pitch - 30 seconds]
"Acre is a privacy-preserving income verification protocol.
Gig workers prove their income without revealing the amount.
Lenders query Acre to check eligibility.
Everyone's privacy is protected."

[Demo - 3 minutes]

1. "User clicks 'Verify Income'"
   [Click button, show QR code]

2. "Scans QR, logs into Uber"
   [Show Reclaim flow, skip to result]

3. "Acre verifies the proof..."
   [Wait 2 seconds]

4. "Stores on Algorand..."
   [Click link, show contract storage]

5. "Lender can now check eligibility"
   [Show SDK: acre.getEligibility(wallet)]
   Output: { verified: true, tier: 2, limit: 50000 }

6. "Lender issues loan with their own logic"
   [Show lender app, not Acre]

[Explain - 2 minutes]
"Unlike traditional fintech:
- No PDFs uploaded
- No raw data stored
- Acre stores only: tier + limit
- Lender's app handles loans
- Acre handles verification"

[Close]
"That's it. Simple, privacy-preserving, DPDP-compliant."
```

---

## Key Takeaways

1. **Acre is NOT a lender** - It's a verification bureau
2. **Acre has 2 functions** - verify_income() and get_eligibility()
3. **Lenders build loan logic** - Not Acre's responsibility
4. **Privacy by design** - Raw data never touches Acre
5. **Simple MVP** - Don't overthink it

Start building! 🚀


## 🚀 Demo Script for Judges

```
[Pitch: 30 seconds]
"Acre Protocol makes it easy for gig workers to get loans without 
giving up their financial privacy. In 3 seconds, we can verify income, 
assign a credit tier, and issue a loan. All without storing any raw data."

[Demo: 3 minutes]

1. Click "Connect Uber Income" button
2. [Show QR code] "This QR code opens Reclaim's secure app"
3. [Demonstrate scanning - you can simulate if no actual Uber account]
4. "User logs into Uber... Reclaim witnesses the login..."
5. [Wait 2-3 seconds - or skip to cached result]
6. "Proof arrives at our platform"
7. "Smart contract verifies it in 200ms..."
8. [UI updates] "✓ Income Verified! Tier 2. Credit Limit: ₹50,000"
9. "User can now request a loan"

[Explain: 2 minutes]
"Here's what makes this different from traditional fintech:

Traditional Approach:
- User uploads PDF → Platform stores it → Privacy nightmare → Hacking target

Acre Approach:
- User logs into Uber on THEIR device → Reclaim witnesses (can't decrypt)
- Device generates ZK proof: 'Income > ₹25k' (doesn't reveal amount)
- Only 200-byte proof goes to our platform
- Smart contract verifies + stores on Algorand
- Zero raw data stored

This makes us DPDP-compliant by design, not because we tried hard."

[Close: 30 seconds]
"Next steps:
- Phase 1: This MVP (income verification + credit scoring)
- Phase 2: Integrate with actual NBFCs (real loan disbursement)
- Phase 3: Multi-chain + more income sources"
```
