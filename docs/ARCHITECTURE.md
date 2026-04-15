# Acre Protocol — System Architecture

> High-level and detailed architectural documentation for the Acre privacy-preserving income verification protocol.

## Table of Contents

1. [System Overview](#system-overview)
2. [Core Principles](#core-principles)
3. [System Components](#system-components)
4. [High-Level Architecture Diagram](#high-level-architecture-diagram)
5. [Detailed Interaction Flows](#detailed-interaction-flows)
6. [Trust Boundaries](#trust-boundaries)
7. [Off-Chain vs On-Chain Responsibilities](#off-chain-vs-on-chain-responsibilities)
8. [Security Model](#security-model)
9. [Data Flow & Privacy](#data-flow--privacy)

---

## System Overview

**Acre** is a **zero-knowledge income verification protocol** that allows gig workers to prove their earning capacity to lenders **without revealing any raw financial data**.

It bridges Web2 income sources (Uber, banks, Razorpay, etc.) with Web3 (Algorand) using **Reclaim zk-TLS** for attestation and **Noir** for zero-knowledge proofs.

**Core Value Proposition:**  
Privacy + Verifiability + Composability on Algorand.

---

## Core Principles

- **Data Minimization** (DPDP Act compliant)
- **Zero-Knowledge** — Prove predicates, never reveal data
- **On-chain Finality** — Immutable eligibility signals
- **Permissionless Reads** — Any lender can query
- **Minimal On-chain Footprint** — ~70 bytes per user

---

## System Components

| Layer                  | Component                        | Technology                          | Responsibility |
|------------------------|----------------------------------|-------------------------------------|--------------|
| **Client**             | Acre Web App                     | React + Vite + Pera/Defly           | UI, Wallet, Reclaim SDK |
| **Proof Engine**       | Reclaim Protocol                 | zk-TLS + Noir Circuits              | Attestation & ZK Proof Generation |
| **Backend**            | Acre Verifier Service            | Node.js + Express                   | Proof validation, tier calculation, chain submission |
| **Blockchain**         | AcreVerification Contract        | PyTeal (ARC-4) on Algorand          | Immutable state storage & eligibility queries |
| **Lending Layer**      | Fintech SDK / dApps              | TypeScript / Any language           | Read eligibility & issue loans |
| **Monitoring**         | Algorand Indexer + Logs          | Indexer + Event listening           | Audit & notifications |

---

## High-Level Architecture Diagram

```mermaid
flowchart TD
    subgraph Web2 ["Web2 World"]
        A[Income Sources\nUber, Bank AA, Razorpay]
    end

    subgraph ProofLayer ["Proof Layer"]
        B[Reclaim zk-TLS Attestors]
        C[Noir ZK Circuit\nClient-side]
    end

    subgraph Backend ["Acre Backend"]
        D[Express Server]
        E[Tier Calculation Logic]
    end

    subgraph Algorand ["Algorand Blockchain"]
        F[AcreVerification Contract]
        G[Local State per User]
    end

    subgraph Consumer ["Consumers"]
        H[Lenders / Fintechs / DeFi Pools]
    end

    A -->|TLS Session| B
    B -->|Signed Proof| C
    C -->|ZK Proof| D
    D -->|Validate + Tier| E
    E -->|verify_income()| F
    F --> G
    H -->|get_eligibility()| F
```

---

## Detailed Interaction Flows

### 1. High-Level User Journey

```mermaid
sequenceDiagram
    participant W as Worker
    participant F as Frontend
    participant R as Reclaim
    participant B as Backend
    participant SC as Smart Contract
    participant L as Lender

    W->>F: Connect Wallet + Click Verify
    F->>R: Create Reclaim Session (QR)
    W->>R: Scan QR & Login to Uber
    R->>W: Generate ZK Proof (client-side)
    W->>F: Return Proof
    F->>B: POST /verify-proof
    B->>B: Verify Signature + Extract Data
    B->>B: Calculate Tier & Credit Limit
    B->>SC: verify_income() [as Verifier]
    SC->>SC: Validate + Store Local State
    SC-->>B: Confirmed
    B-->>F: Success + Tier Info
    F-->>W: Show "Tier 2 Verified"
    
    L->>SC: get_eligibility(wallet)
    SC-->>L: Credit Limit
```

### 2. Low-Level Verification Flow

```mermaid
sequenceDiagram
    participant Backend
    participant ReclaimSDK
    participant Algorand

    Backend->>ReclaimSDK: Reclaim.verifyProof(proof)
    ReclaimSDK-->>Backend: true/false + ECDSA validation
    
    Backend->>Backend: Generate proofHash (SHA256)
    Backend->>Backend: Calculate Tier & Limit
    
    Backend->>Algorand: AtomicTransactionComposer.verify_income(...)
    Algorand->>Algorand: Asserts (verifier, opt-in, timestamp, tier)
    Algorand->>Algorand: LocalPut (8 keys)
    Algorand->>Algorand: GlobalPut (proof_count)
    Algorand-->>Backend: Tx Confirmed
```

---

## Trust Boundaries

| Boundary                  | Trusted Entities                     | Untrusted / External |
|--------------------------|--------------------------------------|----------------------|
| **User Device**          | Worker’s phone/browser               | - |
| **Reclaim Network**      | Reclaim attestors (Byzantine)        | External income sources |
| **Backend**              | Verifier wallet                      | Backend server (can be compromised) |
| **Blockchain**           | Algorand consensus                   | - |
| **Lenders**              | Any party (permissionless)           | Lenders (can misbehave) |

**Critical Trust Assumptions:**
- Reclaim attestors are honest (decentralized)
- Backend verifier key is secure
- Algorand liveness and security

---

## Off-Chain vs On-Chain Responsibilities

### Off-Chain
- Heavy computation (ZK proof generation)
- Raw data handling (never leaves user device)
- Complex business logic (tier calculation)
- Reclaim integration & signature verification
- User experience (UI/UX, QR scanning)

### On-Chain
- **Immutable eligibility state**
- Authorization enforcement (only verifier can write)
- Freshness & replay protection
- Permissionless queries (`get_eligibility`)
- Audit trail via logs

---

## Security Model

### Threat Model & Mitigations

| Threat                        | Mitigation |
|------------------------------|----------|
| Fake / Tampered Proof         | `Reclaim.verifyProof()` + ECDSA signatures |
| Replay Attack                 | On-chain `proof_hash` uniqueness |
| Backdated Proof               | Timestamp monotonicity check |
| Unauthorized Write            | Verifier-only + Admin/Verifier separation |
| Data Leakage                  | Zero raw data stored anywhere |
| User Impersonation            | Wallet-based + Opt-in requirement |
| Backend Compromise            | Limited to calling `verify_income` only |
| Privacy Breach                | DPDP-compliant data minimization |

### Cryptographic Guarantees

- **zk-TLS** — Server authenticity via Reclaim attestors
- **Noir SNARKs** — Zero-knowledge predicates
- **SHA256** — Proof commitment
- **Algorand** — Deterministic execution + fast finality

---

## Data Flow & Privacy

```mermaid
flowchart LR
    subgraph Private ["Private Domain"]
        Raw[Raw Income Data] --> NeverLeaves[Stays on Device]
    end

    subgraph Public ["Public Domain"]
        Proof[ZK Proof + Signals] --> Backend
        Backend --> OnChain[On-chain: Tier + Limit + Hash]
        OnChain --> Lender[Lender Query]
    end
```

**Privacy Guarantee:**  
Only `true/false` predicates + tier + credit limit are revealed. Exact income, transactions, and identities remain hidden.

---

**This document serves as the single source of truth for Acre’s architecture.**

---

---

### 1. Step-by-Step User Flow (Sequence Diagram)

```markdown
### Step-by-Step User Flow

```mermaid
sequenceDiagram
    participant W as Worker
    participant F as Acre Frontend
    participant R as Reclaim Protocol
    participant B as Acre Backend
    participant SC as Algorand Smart Contract

    W->>F: 1. Opens dApp & clicks "Verify Uber Income"
    F->>R: 2. Calls Reclaim SDK to create session (QR Code)
    F-->>W: Shows QR Code

    W->>R: 3. Scans QR with phone
    W->>R: 4. Logs into Uber Driver App
    R->>R: 5. Attestor witnesses TLS handshake (encrypted)
    
    R->>W: 6. Worker selects data to share
    R->>W: 7. Generates ZK Proof on device<br/>(Proves earnings > ₹40k without revealing amount)

    W->>F: 8. Proof returned to frontend
    F->>B: 9. Sends proof to backend (POST /verify-proof)

    B->>B: Validates Reclaim signatures (ECDSA)
    B->>B: Extracts metrics + Calculates credit tier

    B->>SC: 10. Calls verify_income() on smart contract
    SC->>SC: Verifies proof hash, timestamp, opt-in, etc.
    SC-->>B: Transaction Confirmed

    B-->>F: Success response with tier & credit limit
    F-->>W: 11. Displays "Tier 2 Verified • ₹50,000 Limit"
```

**This diagram clearly shows the complete happy path flow.**
```

---

### 2. Architecture — What We Build vs Reclaim

```markdown
### Architecture (What We Build vs Reclaim)

```mermaid
flowchart TD
    subgraph Acre ["Acre DApp (What You Build)"]
        direction TB
        FE[Frontend<br/>React + Reclaim SDK + Wallet]
        BE[Backend<br/>Node.js Express]
        SC[Algorand Smart Contract<br/>PyTeal]
        
        FE <--> BE
        BE <--> SC
    end

    subgraph Reclaim ["Reclaim Protocol (External)"]
        direction TB
        AT[Attestor Network<br/>TLS Witnesses]
        ZK[ZK Circuit<br/>Noir - Client Side]
        PO[Proof Output]
        
        AT --> ZK
        ZK --> PO
    end

    USER[Worker Device\nBrowser / Mobile] <--> FE
    USER <--> AT

    FE -->|"1. Init Session + QR"| RSession[Reclaim Session]
    RSession --> AT

    PO -->|"8. ZK Proof"| FE

    classDef acre fill:#4F46E5,stroke:#fff,color:white
    classDef reclaim fill:#10B981,stroke:#fff,color:white
    class Acre,FE,BE,SC acre
    class Reclaim,AT,ZK,PO reclaim
```

**Legend:**
- **Blue** = What **you build** (Acre)
- **Green** = What **Reclaim provides**

---

### Bonus: Combined High-Level Archit

```mermaid
flowchart LR
    subgraph User
        W[Worker]
    end

    subgraph "Acre Application"
        FE[Frontend]
        BE[Backend]
    end

    subgraph "Reclaim Protocol"
        RA[Attestors + zk-TLS]
        ZKC[Noir ZK Circuit]
    end

    subgraph Blockchain
        ASC["Acre Smart Contract<br/>on Algorand"]
    end

    L[Lender / Fintech]

    W --> FE
    FE --> RA
    RA --> ZKC
    ZKC --> FE
    FE --> BE
    BE --> ASC
    L --> ASC
```
