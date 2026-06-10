# ACRE — Identity Verification Model

How ACRE binds a real human's government identity to a self-custodied crypto wallet, without exposing any personally identifiable information.

---

## The Three-Pillar Model

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│   DigiLocker    │     │  Crypto Wallet  │     │  Platform Proof │
│  (Government)   │  +  │  (Self-custody) │  +  │  (Uber/Swiggy)  │
│   Aadhaar/PAN   │     │  Pera/Defly     │     │  Reclaim zk-TLS │
└────────┬────────┘     └────────┬────────┘     └────────┬────────┘
         │                       │                       │
         └───────────────────────┼───────────────────────┘
                                 ▼
                    ┌─────────────────────┐
                    │   ACRE IDENTITY     │
                    │   (ZK-Bound, Unique)│
                    │                     │
                    │  • Human-proof      │
                    │  • Wallet-bound     │
                    │  • Platform-linked  │
                    │  • Non-transferable │
                    └─────────────────────┘
```

Each pillar proves a different layer of trust. No single pillar is sufficient alone — a valid Aadhaar with no wallet proves nothing on-chain; a wallet with no Aadhaar proves no human is behind it; platform data without identity is legally unusable under DPDP. ACRE requires all three in sequence.

---

## Pillar 1 — Government Identity (DigiLocker)

**What it proves:** A real, UIDAI-verified human consented to share their Aadhaar claims.

**How it works:**
1. ACRE calls the Setu DigiLocker API to create a consent session
2. The user is redirected to DigiLocker's government-hosted OAuth page (`digilocker.gov.in`)
3. The user enters their Aadhaar number + mobile OTP directly on the government page — ACRE never sees the raw Aadhaar number
4. UIDAI verifies the OTP; DigiLocker grants consent and redirects back
5. ACRE fetches the eKYC payload from Setu: masked number, date of birth, address country

**Claims extracted** (boolean only — no raw data stored):

| Claim | Derivation | Key in `claimHashes` |
|---|---|---|
| `indian_citizen` | `address.country == "India"` | `indianCitizen` |
| `age_over_18` | `dateOfBirth` → age calculation | `ageOver18` |
| `verified_human` | Aadhaar biometric attestation exists | `verifiedHuman` |

**Privacy guarantee:** The Aadhaar number, name, and full address never leave the DigiLocker/Setu layer. ACRE only receives boolean flags and a masked number for display.

---

## Pillar 2 — Wallet Binding (Algorand)

**What it proves:** The identity claims are mathematically bound to one specific Algorand wallet address and cannot be reused by or transferred to another wallet.

**How it works — Claim Hash:**

Every claim is individually hashed with the wallet address baked in:

```
claimHash = SHA256(
  "acre-identity-v1|wallet:<ALGORAND_ADDRESS>|claim:<TYPE>|value:<BOOL>"
)
```

Examples:
```
SHA256("acre-identity-v1|wallet:ABC123...|claim:indian_citizen|value:true")
SHA256("acre-identity-v1|wallet:ABC123...|claim:age_over_18|value:true")
SHA256("acre-identity-v1|wallet:ABC123...|claim:verified_human|value:true")
```

If an attacker tried to use the same Aadhaar session for a different wallet address, every claim hash would change — the entire ZK proof chain would break.

**Wallet commitment (public input binding):**

The AlgoPlonk proof additionally commits to the wallet address via:

```
walletCommitment = SHA256("acre-wallet-v1|<ALGORAND_ADDRESS>")
```

This is asserted as `publicInputs[1]` in the ZK proof — on-chain verifiers can confirm the proof was generated for this specific wallet and no other.

---

## Pillar 3 — Platform Proof (Reclaim zk-TLS)

**What it proves:** The wallet owner actually worked on a gig platform (Uber, Swiggy, etc.) — not just claimed to.

**How it works:**
1. ACRE displays a QR code; the user scans it with the Reclaim Protocol mobile app
2. Reclaim opens a TLS session to the platform's API (e.g., `riders.uber.com`) inside a trusted execution environment
3. Reclaim records a selective-disclosure proof of specific API response fields (trip count, rating, earnings period) — not the raw response
4. ACRE receives an ECDSA-signed proof object and calls `Reclaim.verifyProof()` to validate the signature
5. Extracted signals: `tripsCompleted`, `driverRating`, `monthlyEarnings`, `accountAgeMonths`

**What's never revealed:** Login credentials, personal address, payment details, full trip history.

---

## How the Three Pillars Combine

```
DigiLocker session resolved
         │
         ▼
  computeIdentityFlags(aadhaarPayload)
  → isIndian: true
  → ageOver18: true
  → isVerifiedHuman: true
         │
         ▼
  buildClaimHash(walletAddress, "indian_citizen", "true")
  buildClaimHash(walletAddress, "age_over_18", "true")
  buildClaimHash(walletAddress, "verified_human", "true")
         │
         ▼
  AlgoPlonk proof generated:
  proofHex         = ZK proof bytes (32-byte chunks)
  publicInputsHex  = claimHash || walletCommitment
         │
         ▼
  verifyAlgoPlonkProof():
  ✓ publicInputs[0] === claimHash        (consent anchor integrity)
  ✓ publicInputs[1] === walletCommitment (wallet binding)
  ✓ optionally: on-chain verifier call   (onchain_verified mode)
         │
         ▼
  Reclaim.verifyProof(reclaimProof)
  ✓ ECDSA signature valid
  ✓ contextAddress === walletAddress     (proof bound to this wallet)
         │
         ▼
  callVerifyIncomeOnChain():
  → ABI call to AcreVerification contract
  → writes to user's local state (8 slots)
```

---

## On-Chain Storage — AcreVerification Contract

ACRE's PyTeal contract (`acre_verification.py`, deployed on Algorand TestNet) stores the verification outcome in the user's **local state** — 8 key-value slots, written only when the backend's `verify_income` ABI call is accepted.

| Slot key | Type | Value |
|---|---|---|
| `v` | uint8 | Verified flag: `1` = verified |
| `t` | uint8 | Income tier: `1`, `2`, or `3` |
| `l` | uint64 | Credit limit in rupees (e.g., `50000`) |
| `ts` | uint64 | Unix timestamp of last verification |
| `ph` | bytes[32] | SHA256 of the Reclaim proof (replay prevention) |
| `rc` | uint64 | Total platform rides/orders |
| `rr` | uint64 | Rating × 100 (e.g., `485` = 4.85★) |
| `p` | string | Platform name (`"uber"`, `"swiggy"`) |

**Write guard:** The contract checks `Txn.sender() == App.globalGet("verifier")` — only ACRE's backend account can write. Users cannot manipulate their own local state.

**Read by lenders:** Any lender holding the user's wallet address can query local state via Algorand Indexer with no on-chain cost.

---

## Non-Transferability Guarantee

An ACRE identity cannot be transferred to another wallet because all three binding mechanisms would break simultaneously:

| What changes | What breaks |
|---|---|
| Different wallet address | All claim hashes change (wallet address is in the preimage) |
| Different wallet address | `walletCommitment` in AlgoPlonk public inputs changes |
| Different wallet address | `contextAddress` in Reclaim proof won't match |
| Different wallet address | Local state is stored per-address; contract checks `appAccounts[0]` |

There is no "copy identity to new wallet" operation. A new wallet must go through the full three-pillar flow.

---

## Consent Token

After a successful full-pipeline verification, ACRE issues an HMAC-SHA256 signed consent token:

```json
{
  "kind": "consent",
  "user_pubkey": "<32-byte ed25519 public key, hex>",
  "enterprise_pubkey": "<ACRE registrar public key, hex>",
  "claim_hash": "<SHA256 of the bound claim>",
  "consent_txid": "<Algorand tx ID of the income verification>",
  "note_txid": "<Algorand tx ID of the note anchor>",
  "expires_at": 1749600000,
  "iat": 1747008000,
  "mode": "local",
  "identity_provider": "digilocker",
  "zk_backend": "algoplonk"
}
```

Token format: `base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, ACRE_DEMO_SECRET))`

**Lender verification flow:**
1. Lender receives the token from the worker
2. Lender calls `POST /api/lender/verify-consent` with the token + wallet address
3. ACRE re-derives the HMAC and checks `user_pubkey` matches the wallet address
4. Lender optionally queries the `note_txid` on Algorand Indexer to see the full consent JSON anchored on-chain
5. Lender queries local state for `v=1`, `t`, `l` to read current credit tier

---

## Ed25519 Attestation

Before the consent token is issued, ACRE's registrar key signs the raw claim parameters:

```
attestation = Ed25519Sign(
  registrar_private_key,
  claimHash_bytes          (32 bytes)
  || user_pubkey_bytes     (32 bytes)
  || enterprise_pubkey_bytes (32 bytes)
  || expiry_timestamp      (8 bytes, big-endian uint64)
)
```

This 64-byte signature lets a lender verify — without calling any API — that ACRE's authority signed off on this specific claim, for this specific wallet, expiring at this specific time.

---

## Note Anchor — Permanent On-Chain Audit Trail

Independently of the contract's local state, ACRE submits a **0-algo self-payment** to Algorand with the full consent record in the transaction's `note` field:

```json
{
  "kind": "acre-consent-v1",
  "user_pubkey": "...",
  "enterprise_pubkey": "...",
  "claim_hash": "...",
  "expiry_timestamp": 1749600000,
  "claim_type": "indianCitizen",
  "identity_provider": "digilocker",
  "zk_backend": "algoplonk",
  "zk_verification_mode": "shape_verified",
  "income_tx_id": "...",
  "issued_at": 1747008000
}
```

This transaction is permanently queryable at `testnet.algoexplorer.io/tx/<note_txid>`. It is not dependent on the app's local state or any Algorand node — any party with the tx ID can independently read and verify the consent record using the public Algorand Indexer.

**Why this matters under DPDP:** The note anchor is the immutable consent log that regulators and auditors can inspect. No raw personal data appears in the note — only hashes, public keys, and timestamps.

---

## Security Properties Summary

| Property | Mechanism |
|---|---|
| Sybil resistance | One Aadhaar → one consent session; session bound to wallet at creation |
| Replay prevention | `proof_hash` (SHA256 of Reclaim proof) stored in local state slot `ph` |
| Claim integrity | `publicInputs[0]` must equal `claimHash` (ZK circuit commits to the claim) |
| Wallet binding | `publicInputs[1]` must equal `SHA256("acre-wallet-v1|\|<addr>")` |
| Write authority | Contract checks `Txn.sender() == verifier_address` |
| Consent expiry | `expires_at` in consent token; local state `ts` lets lenders check freshness |
| Offline verifiability | Ed25519 attestation + HMAC consent token verifiable without ACRE API |
| Regulatory auditability | Note anchor on public Algorand ledger; no PII, only hashes |
