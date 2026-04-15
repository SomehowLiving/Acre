# Acre Protocol — API Documentation

> Complete reference for **Backend HTTP API** and **Algorand Smart Contract** endpoints.


## Table of Contents

1. [Overview](#overview)
2. [Backend HTTP API](#backend-http-api)
3. [Smart Contract Methods](#smart-contract-methods)
4. [Error Handling & Codes](#error-handling--codes)
5. [Data Types & Formats](#data-types--formats)
6. [Security & Authentication](#security--authentication)
7. [Examples](#examples)

---

## Overview

Acre exposes two layers of APIs:

- **HTTP REST API** (Backend): Used by the frontend for proof submission and status checks.
- **Smart Contract ABI** (Algorand): Permissionless read methods for lenders + restricted write methods.

All sensitive operations are protected. Reads are completely open and gas-free.

---

## Backend HTTP API

**Base URL:** `http://localhost:3001` 

### Authentication
No API keys required for public endpoints. The backend uses the `VERIFIER_MNEMONIC` internally to sign blockchain transactions.

### Endpoints

### 1. Verify Income Proof (Main Endpoint)

**POST** `/verify-proof`

**Description:** Submits a Reclaim ZK proof for verification and on-chain storage.

**Request Body**
```json
{
  "proof": { ... },           // Full Reclaim proof object (required)
  "walletAddress": "string"   // Algorand address (required)
}
```

**Success Response** (200)
```json
{
  "success": true,
  "tier": 2,
  "creditLimit": 25000,
  "txId": "JFASFYIBWEYBW7GFBQWBQW...",
  "message": "Established driver: ₹45,230/month"
}
```

**Error Responses**
- 400 → Invalid proof or missing fields
- 409 → User not opted in (`needsOptIn: true`)

---

### 2. User Eligibility Queries

| Method | Endpoint | Description | Response |
|-------|---------|-----------|---------|
| GET | `/api/user/:address/eligibility` | Credit limit (0 if not verified) | `{ success: true, address, eligibility: 25000 }` |
| GET | `/api/user/:address/verified` | Verification status | `{ success: true, verified: true/false }` |
| GET | `/api/user/:address/tier` | Income tier | `{ success: true, tier: 2 }` |
| GET | `/api/user/:address/credit-limit` | Credit limit | `{ success: true, creditLimit: 25000 }` |
| GET | `/api/user/:address/full-profile` | Complete profile | See example below |
| GET | `/api/user/:address/proof-hash` | Proof hash (for audit) | `{ success: true, proofHash: "0x..." }` |

**Full Profile Example**
```json
{
  "success": true,
  "address": "ABCD...",
  "profile": {
    "verified": true,
    "tier": 2,
    "creditLimit": 25000,
    "timestamp": 1741987200,
    "riderCount": 2102,
    "riderRating": 469,
    "platform": "uber"
  }
}
```

---

### 3. Admin & System Endpoints

| Method | Endpoint | Description | Access |
|-------|---------|-----------|-------|
| GET | `/api/verifier` | Current verifier address | Public |
| GET | `/api/admin` | Contract admin address | Public |
| GET | `/api/proof-count` | Total verifications processed | Public |
| POST | `/api/update-verifier` | Rotate verifier address | Admin only |

**Update Verifier Request**
```json
{
  "newVerifier": "NEWVERIFIERADDRESS..."
}
```

---

## Smart Contract Methods (PyTeal ABI)

**Application ID:** `APP_ID` (set in `.env`)

### Write Methods (Restricted)

| Method | Caller | Description |
|-------|-------|-----------|
| `verify_income` | Verifier only | Store verification result + local state |
| `update_verifier` | Admin only | Change backend verifier address |

### Read Methods (Permissionless)

| Method | Returns | Description |
|-------|--------|-----------|
| `get_eligibility(address)` | uint64 | Credit limit (0 if not verified) |
| `is_verified(address)` | uint8 | 1 = verified, 0 = not |
| `get_tier(address)` | uint8 | 1, 2, or 3 |
| `get_credit_limit(address)` | uint64 | Credit limit in rupees |
| `get_full_profile(address)` | Tuple | All profile data |
| `get_proof_hash(address)` | bytes[32] | SHA256 proof hash |
| `get_verifier()` | address | Current verifier |
| `get_admin()` | address | Contract admin |
| `get_proof_count()` | uint64 | Total proofs |

---

### `verify_income` Parameters

```python
verify_income(
    user_wallet: Address,
    tier: Uint8,           # 1, 2, or 3
    credit_limit: Uint64,  # in rupees
    timestamp: Uint64,
    proof_hash: StaticBytes[32],
    rider_count: Uint64,
    rider_rating: Uint64,  # rating * 100
    platform: String
)
```

---

## Error Handling & Codes

### HTTP Errors

| Code | Message | Meaning |
|------|--------|-------|
| 400 | Missing proof / walletAddress | Bad request |
| 400 | Invalid proof signature | Reclaim verification failed |
| 409 | User must opt in first | `needsOptIn: true` |
| 500 | Internal verification error | Backend issue |

### Smart Contract Errors (Transaction Rejection)

- `Only verifier can submit proofs`
- `User must opt in first`
- `New timestamp must be newer`
- `Invalid tier`
- `Only admin can update verifier`

---

## Data Types & Formats

- **Addresses:** Base32 Algorand format (e.g., `ABCD...1234`)
- **Credit Limit:** Integer in rupees (not micro units)
- **Timestamp:** Unix timestamp (seconds)
- **Proof Hash:** 64-character lowercase hex string
- **Rider Rating:** Integer (e.g., 469 = 4.69 stars)

---

## Security & Authentication

- **Writes:** Only the designated verifier wallet can call `verify_income`
- **Proof Integrity:** Enforced by `Reclaim.verifyProof()`
- **Replay Protection:** Proof hash stored on-chain
- **Freshness:** Timestamp validation
- **Opt-in Required:** Prevents unauthorized state writes
- **No Raw Data:** Never stored on backend or blockchain

---

## Examples

### 1. Frontend Verification Flow

```typescript
const response = await fetch(`${BACKEND_URL}/verify-proof`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ proof, walletAddress })
});

const result = await response.json();
```

### 2. Checking Eligibility (SDK Style)

```typescript
const eligibility = await acre.getEligibility(workerAddress);
// or direct call
const result = await callReadMethod({
  methodName: 'get_eligibility',
  methodArgs: [workerAddress]
});
```

### 3. Full Profile Query

```bash
curl http://localhost:3001/api/user/ABCD...XYZ/full-profile
```

---

## Notes for Developers

- Always check `needsOptIn` flag and trigger opt-in flow if returned.
- Use Algorand Indexer to listen to `VERIFIED|...` logs for real-time updates.
- Backend must have sufficient ALGO in verifier account.
- All read operations are free and rate-limit free.

---

**This document is the single source of truth for all Acre APIs.**
