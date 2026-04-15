# Acre Protocol — Smart Contract Documentation

> Detailed specification of the **AcreVerification** Algorand smart contract.

## Table of Contents

1. [Overview](#overview)
2. [State Schema](#state-schema)
3. [Global State](#global-state)
4. [Local State (Per User)](#local-state-per-user)
5. [Contract Methods](#contract-methods)
6. [Key Invariants & Security](#key-invariants--security)
7. [Storage Costs](#storage-costs)
8. [Usage Examples](#usage-examples)

---

## Overview

The **AcreVerification** contract is the on-chain core of the Acre protocol. It acts as a **privacy-preserving credit eligibility registry**.

- Stores only **verified signals** (tier, credit limit, metadata)
- Never stores raw income data
- Only the designated **verifier** (backend) can write
- Anyone can read eligibility (permissionless)
- Designed for minimal storage and low transaction costs

**Key Design Principles:**
- Data minimization (DPDP compliant)
- Replay protection via proof hash
- Freshness enforcement via timestamps
- Atomic updates

---

## State Schema

### Global State (Contract Level)

| Key              | Type     | Description                          | Default / Notes |
|------------------|----------|--------------------------------------|-----------------|
| `admin`          | Address  | Contract administrator               | Set at creation |
| `verifier`       | Address  | Backend wallet allowed to verify     | Initially = admin |
| `pcnt`           | Uint64   | Total number of proofs processed     | Starts at 0 |

### Local State (Per User Wallet)

| Key   | Type          | Description                              | Size     |
|-------|---------------|------------------------------------------|----------|
| `v`   | Uint8         | Verified flag (0 = no, 1 = yes)          | 1 byte   |
| `t`   | Uint8         | Income tier (1, 2, or 3)                 | 1 byte   |
| `l`   | Uint64        | Credit limit in rupees                   | 8 bytes  |
| `ts`  | Uint64        | Verification timestamp (Unix)            | 8 bytes  |
| `ph`  | Bytes[32]     | SHA256 hash of Reclaim proof             | 32 bytes |
| `rc`  | Uint64        | Rider / transaction count                | 8 bytes  |
| `rr`  | Uint64        | Rider rating × 100 (e.g. 469 = 4.69)    | 8 bytes  |
| `p`   | String        | Platform identifier ("uber", etc.)       | variable |

**Total per user:** ~70 bytes

---

## Contract Methods

### Write Methods (Restricted)

#### 1. `verify_income`

**Description:** Main method called by backend to store verification result.

```python
verify_income(
    user_wallet: abi.Address,
    tier: abi.Uint8,           # 1, 2, or 3
    credit_limit: abi.Uint64,  # in rupees
    timestamp: abi.Uint64,
    proof_hash: abi.StaticBytes[Literal[32]],
    rider_count: abi.Uint64,
    rider_rating: abi.Uint64,
    platform: abi.String
)
```

**Validations Performed:**
- Caller must be the current `verifier`
- User must have opted into the contract
- Tier must be between 1 and 3
- If re-verification: new timestamp must be newer
- Writes all local state atomically
- Increments global proof counter
- Emits log event: `VERIFIED|...`

---

#### 2. `update_verifier`

**Description:** Admin-only method to rotate the verifier address.

```python
update_verifier(new_verifier: abi.Address)
```

**Validation:** Only `admin` can call.

---

### Read Methods (Permissionless)

| Method                    | Returns                          | Description |
|--------------------------|----------------------------------|-----------|
| `get_eligibility`        | Uint64                           | Credit limit (0 if not verified) |
| `is_verified`            | Uint8                            | 1 = verified |
| `get_tier`               | Uint8                            | 1 / 2 / 3 |
| `get_credit_limit`       | Uint64                           | Credit limit in rupees |
| `get_full_profile`       | Tuple (UserProfile)              | All fields |
| `get_proof_hash`         | Bytes[32]                        | Proof hash |
| `get_verifier`           | Address                          | Current verifier |
| `get_admin`              | Address                          | Contract admin |
| `get_proof_count`        | Uint64                           | Total verifications |

**UserProfile Tuple Definition:**
```python
class UserProfile(abi.NamedTuple):
    verified: abi.Uint8
    tier: abi.Uint8
    credit_limit: abi.Uint64
    timestamp: abi.Uint64
    rider_count: abi.Uint64
    rider_rating: abi.Uint64
    platform: abi.String
```

---

## Key Invariants & Security

### Enforced Invariants

1. **Verifier Authorization** — Only designated verifier can call `verify_income`
2. **Opt-in Required** — Users must opt-in before any local state is written
3. **Tier Range** — Tier always ∈ {1, 2, 3}
4. **Timestamp Monotonicity** — Timestamp can only increase on updates
5. **Verified + Proof Hash** — If `verified=1`, then `proof_hash` must exist
6. **Atomicity** — All local state keys are written in a single transaction

### Security Features

- Replay attack prevention via on-chain `proof_hash`
- No raw data storage
- Clear separation of admin and verifier roles
- All assertions provide clear error messages
- Minimal TEAL version (v8) for broad compatibility

---

## Storage Costs

| Operation                  | Cost (ALGO)     | Notes |
|---------------------------|-----------------|-------|
| First Opt-in              | ~0.1            | Minimum balance increase |
| First Verification        | ~0.05           | Box/Local state creation |
| Subsequent Verification   | ~0.001          | Update existing state |
| Verifier Rotation         | ~0.001          | Global state update |
| Read Operations           | 0               | Free |

**Capacity:** ~14,000 user profiles per 1 MByte of app state.

---

## Usage Examples

### 1. Backend Calling `verify_income`

(See `backend` code for full implementation using `AtomicTransactionComposer`)

### 2. Reading Eligibility (JavaScript)

```typescript
const eligibility = await callReadMethod({
  methodName: 'get_eligibility',
  methodArgs: [userAddress],
  appAccounts: [userAddress]
});
```

### 3. Getting Full Profile

```typescript
const profile = await callReadMethod({
  methodName: 'get_full_profile',
  methodArgs: [userAddress],
  appAccounts: [userAddress]
});
// Returns: [verified, tier, creditLimit, timestamp, riderCount, riderRating, platform]
```

### 4. Listening to Events (Indexer)

```text
Log: VERIFIED|ABCD...XYZ|tier|2|limit|25000|rides|2102|platform|uber
```

---

## Deployment & Compilation

```bash
cd contracts/
python acre_verifier.py
# Generates:
#   acre_approval.teal
#   acre_clear.teal
#   acre_abi.json
```

Then deploy using `algokit` or `goal`.

---

## Future Extensions (Planned)

- Reputation score tracking
- Revocation / expiry mechanism
- Multi-platform support in state
- Box storage for larger metadata

---

**This contract is the single source of truth for Acre’s on-chain verification state.**
