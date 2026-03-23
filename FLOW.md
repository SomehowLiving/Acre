# Acre — Architecture & Flow Diagrams

> All system, user, and data flow diagrams for the Acre protocol.

---

## Table of Contents

1. [System Architecture](#1-system-architecture)
2. [User Flow — Worker Journey](#2-user-flow--worker-journey)
3. [Data Verification Flow](#3-data-verification-flow)
4. [ZK Proof Pipeline](#4-zk-proof-pipeline)
5. [Smart Contract State Machine](#5-smart-contract-state-machine)
6. [Lending Settlement Flow](#6-lending-settlement-flow)
7. [Privacy Model — What Is Hidden vs Proven](#7-privacy-model--what-is-hidden-vs-proven)
8. [Credit Tier Decision Flow](#8-credit-tier-decision-flow)
9. [Fintech SDK Integration Flow](#9-fintech-sdk-integration-flow)
10. [Reputation & Repayment Loop](#10-reputation--repayment-loop)

---

## 1. System Architecture

> The full end-to-end architecture showing how Web2 income data flows through the ZK layer into Algorand and then into a lending protocol.

```mermaid
flowchart LR

    Worker([🧑 Gig Worker])

    subgraph Web2 ["Web2 — Income Sources"]
        B1[🏦 Bank Account\nAccount Aggregator]
        B2[🚗 Uber Earnings]
        B3[🛵 Swiggy Payouts]
        B4[💻 Upwork / Freelance]
        B5[💳 Razorpay / Stripe]
    end

    subgraph ZK ["ZK Layer — Privacy Engine"]
        C[zkTLS / TLSNotary\nData Attestation]
        D[ZK Proof Generator\nNoir Circuits]
    end

    subgraph Algorand ["Algorand — Verification Layer"]
        E[Income Verifier\nSmart Contract]
        F[Credit Eligibility\nEngine]
        G[Reputation\nTracker]
    end

    subgraph Finance ["Finance — Lending Layer"]
        H[Lending Protocol\nFintech / NBFC]
        I[Loan Disbursement\nASA Stablecoin]
        J[Repayment\nTracking]
    end

    Worker --> B1
    Worker --> B2
    Worker --> B3
    Worker --> B4
    Worker --> B5

    B1 --> C
    B2 --> C
    B3 --> C
    B4 --> C
    B5 --> C

    C --> D
    D --> E
    E --> F
    F --> G
    F --> H
    H --> I
    I --> Worker
    Worker --> J
    J --> G
```

---

## 2. User Flow — Worker Journey

> Step-by-step sequence of how a gig worker goes from connecting their income source to receiving a loan.

```mermaid
sequenceDiagram
    actor Worker as 🧑 Gig Worker
    participant App as 📱 Acre App
    participant Attest as 🔐 TLSNotary<br/>Attestation
    participant ZK as ⚙️ Noir ZK<br/>Circuit
    participant Chain as ⛓️ Algorand<br/>Contract
    participant Lender as 🏦 Lending<br/>Protocol

    Worker->>App: Connect income source<br/>(Bank AA / Uber / Swiggy)
    App->>Attest: Initiate TLS session<br/>with income API
    Attest->>Attest: Notarize TLS session<br/>(no content exposed)
    Attest-->>App: Signed attestation blob<br/>{server_id, data_hash, timestamp}

    App->>ZK: Pass attested data<br/>(runs client-side)
    ZK->>ZK: Evaluate predicates<br/>income > ₹40,000?<br/>consistent 6 months?
    ZK-->>App: ZK proof (~200 bytes)<br/>+ public signals

    App-->>Worker: Preview eligibility<br/>income_band: tier_2<br/>credit_limit: ₹50,000<br/>(no raw data shown)
    Worker->>App: Approve & submit proof

    App->>Chain: Submit proof +<br/>public signals +<br/>attestation
    Chain->>Chain: ✅ Verify ZK proof validity
    Chain->>Chain: ✅ Check proof freshness<br/>(< 90 days)
    Chain->>Chain: ✅ Validate source signature

    Chain->>Chain: Write state:<br/>income_verified = true<br/>credit_limit = ₹50,000
    Chain-->>Lender: Emit IncomeVerified event

    Lender->>Lender: Read eligibility signal
    Lender->>Chain: Atomic transfer group<br/>(collateral lock + disburse)
    Chain-->>Worker: 💰 Loan disbursed<br/>(ASA stablecoin)

    Worker->>Chain: Repayment
    Chain->>Chain: Update reputation score
```

---

## 3. Data Verification Flow

> How raw Web2 financial data is transformed into a trustworthy, privacy-preserving attestation.

```mermaid
flowchart TD

    A[🏦 Bank / Platform API\nReal income source] --> B

    B[🔒 TLSNotary Session\nIntercepted TLS handshake\nServer identity proven]

    B --> C[📜 Signed Attestation Blob\nContents:\n• Server identity hash\n• Data hash\n• Timestamp\n• TLSNotary signature]

    C --> D[⚙️ ZK Circuit — Noir\nPrivate: raw income values\nPublic: threshold conditions]

    D --> E{Predicate Checks}

    E --> E1[monthly_income > ₹X ✅]
    E --> E2[consistent_months >= 6 ✅]
    E --> E3[income_band = tier_2 ✅]

    E1 --> F[🔏 ZK Proof Generated\n~200 bytes\nno raw data inside]
    E2 --> F
    E3 --> F

    F --> G[⛓️ Algorand Contract\nVerifies proof\nNo data stored]

    G --> H[✅ Verified Income Credential\nOn-chain state only:\nincome_verified = true\ncredit_limit = ₹50,000]

    style A fill:#e8f4fd,stroke:#2196F3
    style H fill:#e8f5e9,stroke:#4CAF50
    style F fill:#f3e5f5,stroke:#9C27B0
```

---

## 4. ZK Proof Pipeline

> The internal mechanics of the ZK proof — what stays private and what becomes public.

```mermaid
flowchart LR

    subgraph Private ["🔒 Private Inputs — Never Leaves Device"]
        P1[Raw income amounts\n₹42,000 / ₹38,500 / ...]
        P2[Transaction timestamps\n2024-07-01, 2024-08-01 ...]
        P3[Platform tokens\nAPI session credentials]
        P4[Account identifiers\nUAN / account number]
    end

    subgraph Circuit ["⚙️ Noir ZK Circuit"]
        C1[sum / avg\ncalculation]
        C2[range check\nincome > threshold]
        C3[window check\nconsistency over N months]
        C4[band classifier\ntier_1 / tier_2 / tier_3]
    end

    subgraph Public ["📢 Public Outputs — Shared with Contract"]
        O1[income_above_threshold: true]
        O2[income_band: 2]
        O3[consistency_months: 6]
        O4[proof_timestamp: unix]
        O5[source_hash: 0xabc...]
    end

    subgraph Proof ["🔏 ZK Proof"]
        PR[Cryptographic proof\n~200 bytes\nProves outputs are correct\nwithout revealing inputs]
    end

    P1 --> C1
    P2 --> C3
    P3 --> C4
    P4 --> C2

    C1 --> O2
    C2 --> O1
    C3 --> O3
    C4 --> O4

    Circuit --> PR
    PR --> O5

    style Private fill:#fce4ec,stroke:#e91e63
    style Public fill:#e8f5e9,stroke:#4CAF50
    style Proof fill:#f3e5f5,stroke:#9C27B0
```

---

## 5. Smart Contract State Machine

> The lifecycle of a verification request inside the Algorand smart contract.

```mermaid
stateDiagram-v2

    [*] --> Unverified : Worker submits proof

    Unverified --> Rejected : ❌ Invalid ZK proof\n(tampered or forged)
    Unverified --> Expired : ⏰ Proof timestamp\nolder than 90 days
    Unverified --> UntrustedSource : ⚠️ Source attestation\nsignature invalid
    Unverified --> Verified : ✅ All checks passed

    Rejected --> [*] : Worker must regenerate proof
    Expired --> [*] : Worker must refresh data
    UntrustedSource --> [*] : Worker must use approved source

    Verified --> LoanActive : 🏦 Lender issues loan\nvia atomic transfer
    Verified --> ReVerify : 🔄 Proof expired\n(> 90 days later)

    LoanActive --> Repaying : Worker makes\nrepayment
    Repaying --> LoanActive : Partial repayment
    Repaying --> ReputationUpdated : ✅ Loan fully repaid

    ReputationUpdated --> Verified : Score updated\non-chain
    ReVerify --> Verified : New proof submitted

    note right of Verified
        State written on-chain:
        income_verified = true
        income_band = tier_2
        credit_limit = ₹50,000
    end note

    note right of ReputationUpdated
        reputation_score += delta
        repayment_rate updated
        available to future lenders
    end note
```

---

## 6. Lending Settlement Flow

> How Algorand's atomic transfers make loan disbursement secure and atomic.

```mermaid
flowchart LR

    subgraph Inputs ["Transaction Group Inputs"]
        LW[🏦 Lender Wallet\nHolds USDC / ASA]
        BW[🧑 Borrower Wallet\nVerified income credential]
    end

    subgraph ATG ["⚛️ Algorand Atomic Transfer Group\n(All succeed or all fail — no partial execution)"]
        T1[Tx 1: Read eligibility\nfrom Income Verifier contract]
        T2[Tx 2: Lock collateral\nBorrower ASA → escrow]
        T3[Tx 3: Disburse loan\nLender USDC → Borrower]
        T4[Tx 4: Record terms\nLoan params → contract state]
    end

    subgraph Outputs ["Settlement Outputs"]
        O1[✅ Collateral locked\nin escrow account]
        O2[💰 Loan received\nby worker wallet]
        O3[📋 Terms recorded\non-chain]
    end

    LW --> T1
    BW --> T1
    T1 --> T2
    T1 --> T3
    T1 --> T4
    T2 --> O1
    T3 --> O2
    T4 --> O3

    style ATG fill:#e8f4fd,stroke:#2196F3
    style Inputs fill:#fff8e1,stroke:#FFC107
    style Outputs fill:#e8f5e9,stroke:#4CAF50
```

---

## 7. Privacy Model — What Is Hidden vs Proven

> A clear map of what the ZK system reveals to lenders versus what stays with the worker.

```mermaid
flowchart TD

    W[🧑 Gig Worker\nHolds all raw data]

    subgraph Hidden ["🔒 HIDDEN — Never Revealed to Anyone"]
        H1[Exact payment amounts\ne.g. ₹42,350 on July 3]
        H2[Employer / platform names]
        H3[Transaction-level history]
        H4[Account balance]
        H5[Payer identities]
        H6[Bank account number]
    end

    subgraph Proven ["✅ PROVEN — Shared as ZK Proof"]
        P1[monthly_income > ₹40,000 ✅]
        P2[income_consistent_for_6_months ✅]
        P3[income_band = tier_2 ✅]
        P4[data_from_verified_source ✅]
        P5[proof_not_older_than_90_days ✅]
    end

    W --> Hidden
    W --> Proven

    Proven --> L[🏦 Lender sees ONLY\neligibility signal\nNo raw data ever transmitted]

    style Hidden fill:#fce4ec,stroke:#e91e63
    style Proven fill:#e8f5e9,stroke:#4CAF50
    style L fill:#e8f4fd,stroke:#2196F3
```

---

## 8. Credit Tier Decision Flow

> How the ZK proof output maps to credit tiers inside the Algorand contract.

```mermaid
flowchart TD

    A[⛓️ Algorand Contract\nReceives verified ZK proof] --> B{income_band\nfrom proof}

    B --> |band = 1| C1[Tier 1\nMonthly > ₹25,000\nConsistent 3+ months]
    B --> |band = 2| C2[Tier 2\nMonthly > ₹40,000\nConsistent 6+ months]
    B --> |band = 3| C3[Tier 3\nMonthly > ₹70,000\nConsistent 6+ months]
    B --> |band = 0| C0[❌ Not Eligible\nBelow minimum threshold]

    C1 --> L1[Credit Limit: ₹25,000\nTerm: 30 days\nRate: Standard]
    C2 --> L2[Credit Limit: ₹50,000\nTerm: 60 days\nRate: Preferred]
    C3 --> L3[Credit Limit: ₹1,00,000\nTerm: 90 days\nRate: Best]
    C0 --> L0[Advise worker to\nreapply in 3 months]

    L1 --> R{Reputation\nScore Check}
    L2 --> R
    L3 --> R

    R --> |score > 80| RG[✅ Green: Full limit\napproved]
    R --> |score 50–80| RY[🟡 Yellow: 70% limit\napproved]
    R --> |score < 50| RR[🔴 Red: 50% limit\nor manual review]

    style C0 fill:#fce4ec,stroke:#e91e63
    style C1 fill:#fff8e1,stroke:#FFC107
    style C2 fill:#e8f5e9,stroke:#4CAF50
    style C3 fill:#e8f4fd,stroke:#2196F3
```

---

## 9. Fintech SDK Integration Flow

> How a fintech app or NBFC integrates Acre into their existing loan origination workflow.

```mermaid
sequenceDiagram
    actor User as 👤 Loan Applicant
    participant FintechApp as 📱 Fintech App<br/>(NBFC / Lender)
    participant SDK as 🧩 Acre SDK
    participant Chain as ⛓️ Algorand
    participant Pool as 💰 Lending Pool

    User->>FintechApp: Apply for loan

    FintechApp->>SDK: sdk.checkEligibility(walletAddress)
    SDK->>Chain: Read app state\nfor wallet address
    Chain-->>SDK: { verified: true,\n band: tier_2,\n limit: ₹50,000 }
    SDK-->>FintechApp: Eligibility response

    alt Verified ✅
        FintechApp->>FintechApp: Skip document collection\nShow pre-approved offer
        FintechApp-->>User: Offer: ₹50,000 @ preferred rate
        User->>FintechApp: Accept offer

        FintechApp->>SDK: sdk.issueLoan(borrower, amount, term)
        SDK->>Chain: Build atomic transfer group
        Chain->>Pool: Debit loan amount
        Pool-->>Chain: Funds confirmed
        Chain-->>User: 💰 Loan disbursed to wallet

    else Not Verified ❌
        FintechApp-->>User: Prompt to generate\nAcre proof first
        User->>SDK: sdk.generateProof(incomeSource)
        SDK-->>User: Proof generated
        User->>FintechApp: Retry application
    end

    Note over FintechApp,SDK: Integration requires ~50 lines\nof code via Acre SDK
```

---

## 10. Reputation & Repayment Loop

> How on-chain repayment history builds a decentralized credit profile over time.

```mermaid
flowchart TD

    A[🧑 Worker receives loan\nLoan recorded on-chain] --> B[Worker makes repayments]

    B --> C{Repayment behavior}

    C --> |On time| D[✅ reputation_score += 10\nrepayment_rate updated]
    C --> |Late| E[⚠️ reputation_score -= 5\nlate_payment_count += 1]
    C --> |Default| F[❌ reputation_score -= 30\naccess_suspended = true]

    D --> G[📊 Updated credit profile\nOn-chain, non-identifying]
    E --> G
    F --> H[🚫 Access suspended\nReview after 6 months]

    G --> I{Future loan application}

    I --> |score > 80| J[🟢 Premium tier unlocked\nHigher limits\nBetter rates]
    I --> |score 50–80| K[🟡 Standard tier\nSame limits]
    I --> |score < 50| L[🔴 Reduced limits\nHigher rates]

    J --> M[♻️ Cycle continues\nCredit profile grows\nwithout exposing data]
    K --> M
    L --> M

    style D fill:#e8f5e9,stroke:#4CAF50
    style E fill:#fff8e1,stroke:#FFC107
    style F fill:#fce4ec,stroke:#e91e63
    style J fill:#e8f4fd,stroke:#2196F3
```

---

## Summary

| Diagram | Purpose | Audience |
|---------|---------|----------|
| [System Architecture](#1-system-architecture) | Full stack overview |
| [User Flow](#2-user-flow--worker-journey) | Worker journey end-to-end |
| [Data Verification Flow](#3-data-verification-flow) | Trust model for Web2 data |
| [ZK Proof Pipeline](#4-zk-proof-pipeline) | Privacy guarantee mechanics |
| [Smart Contract State Machine](#5-smart-contract-state-machine) | Contract lifecycle |
| [Lending Settlement Flow](#6-lending-settlement-flow) | Atomic transfer design |
| [Privacy Model](#7-privacy-model--what-is-hidden-vs-proven) | What is/isn't revealed |
| [Credit Tier Decision](#8-credit-tier-decision-flow) | Credit scoring logic |
| [SDK Integration](#9-fintech-sdk-integration-flow) | Fintech partner integration |
| [Reputation Loop](#10-reputation--repayment-loop) | Long-term credit building | 

---

*Part of the Acre project — AlgoBharat Hack Series 3.0*
