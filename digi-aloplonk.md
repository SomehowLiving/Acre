# DigiLocker + AlgoPlonk Integration for Acre

This document explains how to integrate DigiLocker and AlgoPlonk into Acre's current architecture so a gig worker:

1. connects an Algorand wallet,
2. completes DigiLocker identity consent,
3. obtains privacy-preserving identity claims,
4. combines those claims with the existing Reclaim income proof flow,
5. receives a score / eligibility decision, and
6. gets the final result anchored on Algorand.

The target architecture is:

`DigiLocker = identity source of truth`

`AlgoPlonk = proof validation layer`

`Algorand = immutable anchor`

## 1. Acre today

Current Acre flow in this repo:

`User -> Reclaim proof -> acre-web -> backend /verify-proof -> Algorand contract`

Relevant code paths:

- Frontend source/proof UX: [acre-web/src/pages/GenerateProof.tsx](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/pages/GenerateProof.tsx)
- Frontend QR/source connection: [acre-web/src/components/proof-generation/SourceConnection.tsx](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/components/proof-generation/SourceConnection.tsx)
- Reclaim integration: [acre-web/src/lib/reclaim.ts](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/lib/reclaim.ts)
- Backend verification client: [acre-web/src/lib/api.ts](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/lib/api.ts)
- Algorand contract: [contracts/acre_verification.py](/home/somehowliving/dev/web3/algorand/acre/contracts/acre_verification.py)

Today Acre stores income-oriented verification outputs on-chain:

- `verified`
- `tier`
- `credit_limit`
- `timestamp`
- `proof_hash`
- `rider_count`
- `rider_rating`
- `platform`

That works for Reclaim income verification, but it does not yet model identity verification, Aadhaar-derived claims, or ZK-backed identity commitments.

## 2. What changes conceptually

Do not think of AlgoPlonk as a full standalone product that Acre must become.

Treat it as an identity-proof input that Acre consumes.

Updated flow:

`User`

`-> Wallet connect`

`-> DigiLocker consent`

`-> AlgoPlonk proof for identity claims`

`-> Reclaim proof for income claims`

`-> Acre backend feature engine`

`-> Blue Score / eligibility decision`

`-> Algorand anchor`

The backend should never rely on raw Aadhaar data as a permanent business object. It should derive small, bounded features:

- `is_verified_human = true`
- `is_indian = true`
- `age_over_18 = true`

Everything else should either be discarded after verification or kept only in short-lived trace logs with explicit controls.

## 3. Recommended target flow

### 3.1 Worker journey

1. Worker connects Algorand wallet in Acre.
2. Acre starts DigiLocker identity session.
3. Worker completes DigiLocker consent in sandbox or production.
4. Backend polls DigiLocker status and fetches Aadhaar claim payload.
5. Backend derives normalized claims:
   - `indian_citizen`
   - `age_over_18`
   - `verified_human`
6. Backend creates a `claim_hash` per identity predicate.
7. Worker or backend receives an AlgoPlonk proof whose first public input is the `claim_hash`.
8. Backend verifies the AlgoPlonk proof:
   - off-chain shape checks always
   - optional on-chain verifier app call on Algorand
9. Reclaim income proof is generated as Acre already does.
10. Backend combines identity features + income features into the Acre scoring model.
11. Backend writes the final eligibility state to the Acre Algorand contract.

### 3.2 Logical separation of duties

- DigiLocker proves identity facts.
- AlgoPlonk proves those identity facts can be validated without exposing raw identity data.
- Reclaim proves income data.
- Acre backend decides policy and scoring.
- Algorand stores the final lending-grade signal.

## 4. Identity model for Acre

The identity layer should expose a minimal typed result to the rest of Acre.

Recommended server-side object:

```ts
type IdentityVerificationResult = {
  walletAddress: string;
  digilockerRequestId: string;
  identityVerified: boolean;
  claimHashes: {
    indianCitizen?: string;
    ageOver18?: string;
    verifiedHuman?: string;
  };
  flags: {
    isIndian: boolean;
    ageOver18: boolean;
    isVerifiedHuman: boolean;
  };
  algoplonk: {
    proofVerified: boolean;
    verificationMode: "shape_verified" | "onchain_verified";
    verifierAppId?: number;
    proofHash?: string;
  };
  audit: {
    verifiedAt: number;
    source: "digilocker";
  };
};
```

The frontend and contract should consume only the bounded parts:

- booleans
- hashes
- timestamps
- verification mode

Not raw Aadhaar metadata.

## 5. Claim hash design

This is the right place to copy the Shunyak pattern.

Do not store:

- `"user is Indian"`
- `"DOB is 2001-08-12"`
- `"Aadhaar masked number is XXXX-XXXX-1234"`

Instead store commitments:

```text
hash("wallet:<wallet>|claim:indian_citizen|value:true")
hash("wallet:<wallet>|claim:age_over_18|value:true")
hash("wallet:<wallet>|claim:verified_human|value:true")
```

Why this matters:

- no raw identity attribute stored on-chain
- proof can validate against a deterministic commitment
- contract and lenders can work with privacy-preserving markers
- replay risk is lower if the wallet address is part of the preimage

Recommended rule:

`claim_hash = sha256(wallet_address + claim_type + claim_value + domain_separator)`

Use a stable domain separator such as `acre-identity-v1`.

## 6. Where DigiLocker should fit in Acre frontend

## 6.1 Current frontend integration points

Current flow is driven by [acre-web/src/pages/GenerateProof.tsx](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/pages/GenerateProof.tsx):

- Step 1: source connection
- Step 2: circuit configuration
- Step 3: proof generation
- Step 4: proof preview

Current source connection UI in [SourceConnection.tsx](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/components/proof-generation/SourceConnection.tsx) is income-source oriented.

## 6.2 Recommended frontend changes

Add identity as a required pre-step before income verification.

Updated UX:

1. `Wallet Connect`
2. `Identity Verification`
3. `Income Source Connection`
4. `Proof Generation`
5. `Eligibility Result`

Recommended implementation:

- Add a new page or module:
  - `acre-web/src/components/identity/DigiLockerConnection.tsx`
- Add new state in `GenerateProof.tsx`:
  - `identityStatus`
  - `digilockerRequestId`
  - `digilockerAuthUrl`
  - `identityClaims`
  - `algoplonkStatus`
- Only allow `handleSourceConnect()` after identity is verified

Suggested client state:

```ts
type IdentityStepState =
  | { status: "idle" }
  | { status: "request_created"; requestId: string; authUrl: string }
  | { status: "pending_user_consent"; requestId: string; authUrl: string }
  | { status: "identity_verified"; requestId: string; flags: {
      isIndian: boolean;
      ageOver18: boolean;
      isVerifiedHuman: boolean;
    }
    claimHashes: string[];
  }
  | { status: "failed"; message: string };
```

## 6.3 Wallet linking rule

This is important.

The DigiLocker session must be linked to the worker's Algorand wallet before verification completes.

Recommended binding:

1. Wallet connects first.
2. Backend issues a short-lived session token tied to:
   - `walletAddress`
   - `nonce`
   - `issuedAt`
3. DigiLocker request is created against that session.
4. When DigiLocker and AlgoPlonk complete, backend stores identity results under that wallet address.

That prevents:

- identity verification floating without a wallet owner
- one user verifying identity and another wallet consuming it
- replay across wallets

## 7. Backend integration design

## 7.1 New backend endpoints

Your current frontend already talks to a backend via `VITE_BACKEND_VERIFY_URL` in [acre-web/src/lib/api.ts](/home/somehowliving/dev/web3/algorand/acre/acre-web/src/lib/api.ts).

Extend the backend with identity endpoints like:

### Create DigiLocker session

`POST /api/identity/digilocker/request`

Request:

```json
{
  "walletAddress": "ALGORAND_ADDRESS",
  "redirectUrl": "https://your-acre-app/identity/callback"
}
```

Response:

```json
{
  "success": true,
  "requestId": "dlg_123",
  "authUrl": "https://dg-sandbox.setu.co/..."
}
```

### Poll DigiLocker status

`GET /api/identity/digilocker/:requestId/status`

Response:

```json
{
  "success": true,
  "status": "pending_digilocker_consent"
}
```

or

```json
{
  "success": true,
  "status": "identity_verified",
  "flags": {
    "isIndian": true,
    "ageOver18": true,
    "isVerifiedHuman": true
  },
  "claimHashes": {
    "indianCitizen": "0x...",
    "ageOver18": "0x..."
  },
  "algoplonk": {
    "proofVerified": true,
    "verificationMode": "onchain_verified"
  }
}
```

### Verify combined proof package

You can either extend the current endpoint or create a new one.

Safer design:

`POST /api/verify-worker-profile`

Request:

```json
{
  "walletAddress": "ALGORAND_ADDRESS",
  "identityRequestId": "dlg_123",
  "reclaimProof": { "...": "..." },
  "algoplonkProofHex": "0x...",
  "algoplonkPublicInputsHex": "0x..."
}
```

This is better than overloading the current `/verify-proof` because the semantics change from income-only verification to multi-source worker profile verification.

## 7.2 Backend processing pipeline

Recommended order:

1. Validate wallet address.
2. Resolve DigiLocker session state.
3. Fetch DigiLocker Aadhaar payload.
4. Derive claims:
   - `is_indian`
   - `age_over_18`
   - `is_verified_human`
5. Build `claim_hash` values.
6. Verify AlgoPlonk proof against claim hashes.
7. Verify Reclaim income proof.
8. Build final feature vector.
9. Run Blue Score / eligibility logic.
10. Write final result on-chain.
11. Return response to Acre frontend.

## 7.3 Derived features for Blue Score

Identity should be a gate first, not a giant scoring component.

Recommended features:

- `identity_verified: boolean`
- `indian_resident_verified: boolean`
- `age_eligible: boolean`
- `income_verified: boolean`
- `income_tier: 1 | 2 | 3`
- `platform_consistency_score: number`
- `platform_reputation_score: number`

Recommended policy:

```python
if not identity_verified:
    reject("identity_not_verified")

if not age_eligible:
    reject("age_requirement_failed")

if not income_verified:
    reject("income_not_verified")

score = blue_score(
    identity_gate=True,
    income_tier=tier,
    consistency=consistency_score,
    reputation=reputation_score,
)
```

This preserves the clean separation:

- identity decides whether the worker can enter the credit pipeline
- income decides how strong the offer can be

## 8. AlgoPlonk integration in Acre

## 8.1 How to think about it

AlgoPlonk should not replace Reclaim.

Reclaim and AlgoPlonk solve different problems:

- Reclaim proves income-source facts
- AlgoPlonk proves identity-claim integrity

In Acre, AlgoPlonk becomes the privacy wrapper around DigiLocker-derived claims.

## 8.2 Minimal AlgoPlonk verification contract strategy

Shunyak's pattern is:

- normalize proof hex
- normalize public inputs
- enforce `public_inputs[0] == claim_hash`
- optionally call verifier app on Algorand

That is a good pattern to copy.

For Acre, your AlgoPlonk verifier interface can be:

```python
verify_identity_claim(
    proof_chunks: byte[32][],
    public_input_chunks: byte[32][]
) -> bool
```

Expected public inputs:

1. `claim_hash`
2. `wallet_commitment`
3. optional `expiry_commitment`

At minimum, bind the proof to:

- the claim being proven
- the wallet intended to use it

## 8.3 Off-chain verification rules

Even before on-chain verification, the backend should enforce:

- proof hex is valid
- public inputs hex is valid
- both decode into `bytes32[]`
- at least one public input exists
- first public input equals computed `claim_hash`
- wallet commitment matches the request wallet

If these fail, reject before calling any contract.

## 8.4 Optional on-chain verification

If you want stronger auditability, use an Algorand verifier app.

Suggested env vars for Acre backend:

```env
ACRE_DIGILOCKER_BASE_URL=https://dg-sandbox.setu.co
ACRE_DIGILOCKER_CLIENT_ID=
ACRE_DIGILOCKER_CLIENT_SECRET=
ACRE_DIGILOCKER_PRODUCT_INSTANCE_ID=
ACRE_DIGILOCKER_REDIRECT_URL=http://localhost:8080/digi
https://your-app/identity/callback
ACRE_DIGILOCKER_TIMEOUT_SECONDS=15

ACRE_ALGOPLONK_VERIFY_APP_ID=
ACRE_ALGOPLONK_VERIFY_METHOD_SIGNATURE=verify(byte[32][],byte[32][])bool
ACRE_ALGOPLONK_REQUIRE_ONCHAIN_VERIFY=false
ACRE_ALGOPLONK_SIMULATE_ONLY=false
```

Recommended production behavior:

- `REQUIRE_ONCHAIN_VERIFY=true` only after the verifier contract is stable
- keep it `false` in early integration so development is not blocked

## 8.5 What to store from AlgoPlonk

Do not store the full proof in Acre contract local state.

Store only:

- `identity_verified = 1`
- `identity_claim_hash = bytes32`
- `identity_verified_at = timestamp`
- `identity_verification_mode = offchain | onchain`
- optional `identity_proof_commitment = sha256(proof)`

That keeps chain storage small and usable for lenders.

## 9. Algorand contract changes for Acre

Current contract in [contracts/acre_verification.py](/home/somehowliving/dev/web3/algorand/acre/contracts/acre_verification.py) only models income verification.

You have two reasonable options.

## Option A: Extend the existing AcreVerification contract

Add local state keys:

- `identity_verified`
- `identity_claim_hash`
- `identity_ts`
- `identity_mode`

Extend `verify_income` into a broader method, for example:

```python
verify_worker_profile(
    user_wallet,
    identity_verified,
    identity_claim_hash,
    identity_timestamp,
    identity_verification_mode,
    tier,
    credit_limit,
    timestamp,
    proof_hash,
    rider_count,
    rider_rating,
    platform
)
```

Pros:

- one contract
- one lender read path
- simpler state queries

Cons:

- ABI changes
- redeploy required
- more coupling between identity and income logic

## Option B: Keep current Acre contract and add a separate identity contract

Use:

- `AcreIdentityVerification`
- existing `AcreVerification`

Backend verifies identity first, stores identity anchor in one app, then stores income / eligibility in the other.

Pros:

- clean separation
- safer migration path
- easier to iterate identity independently

Cons:

- lenders may need two reads unless backend aggregates them
- more moving parts

Recommendation:

For Acre's current maturity, Option B is cleaner if you want fast iteration.

If you want the simplest lender integration and are comfortable redeploying, Option A is better long-term.

## 10. Recommended contract schema if extending current app

Suggested new local state keys:

```python
LS_IDENTITY_VERIFIED = Bytes("iv")
LS_IDENTITY_CLAIM_HASH = Bytes("ich")
LS_IDENTITY_TS = Bytes("its")
LS_IDENTITY_MODE = Bytes("im")
```

Possible encodings:

- `iv`: `0` or `1`
- `ich`: 32-byte hash
- `its`: unix timestamp
- `im`: `b"offchain"` or `b"onchain"`

Suggested invariants:

- identity must be verified before final eligibility is non-zero
- identity timestamp should not move backwards
- identity claim hash should be wallet-bound

## 11. Recommended lender-facing read model

Lenders do not need DigiLocker internals.

They need clean output fields:

```json
{
  "verified": true,
  "identityVerified": true,
  "incomeVerified": true,
  "tier": 2,
  "creditLimit": 25000,
  "identityVerificationMode": "onchain",
  "proofHash": "0x...",
  "identityClaimHash": "0x..."
}
```

This preserves privacy while still giving lenders:

- identity assurance
- income assurance
- auditability

## 12. Suggested Acre backend module layout

Add modules along these lines:

```text
backend/
  services/
    digilocker.ts
    identityClaims.ts
    algoplonk.ts
    reclaimVerifier.ts
    scoring.ts
    algorandWriter.ts
  routes/
    identity.ts
    verification.ts
```

Responsibilities:

- `digilocker.ts`: create request, poll status, fetch Aadhaar, normalize responses
- `identityClaims.ts`: derive claim booleans and claim hashes
- `algoplonk.ts`: proof shape validation and optional verifier app call
- `reclaimVerifier.ts`: existing Reclaim verification logic
- `scoring.ts`: Blue Score and eligibility policy
- `algorandWriter.ts`: compose and submit app calls

## 13. Concrete frontend changes for Acre

## 13.1 `GenerateProof.tsx`

Change the page from income-first to identity-first.

Recommended flow in code:

1. On wallet connect, show identity step.
2. Call backend to create DigiLocker request.
3. Open or display `authUrl`.
4. Poll backend until status becomes `identity_verified`.
5. Only then unlock current Reclaim income flow.
6. On final submit, send:
   - `walletAddress`
   - `identityRequestId`
   - `reclaimProof`
   - `algoplonkProofHex`
   - `algoplonkPublicInputsHex`

## 13.2 `SourceConnection.tsx`

Keep it focused on income sources.

Do not overload it with identity logic.

Instead:

- add a separate `IdentityConnection` component before it
- keep the source connector as the Reclaim income connection stage

That keeps your UX and code understandable.

## 13.3 `api.ts`

Add functions like:

```ts
export async function createDigiLockerRequest(walletAddress: string): Promise<...>
export async function pollDigiLockerStatus(requestId: string): Promise<...>
export async function verifyWorkerProfile(payload: VerifyWorkerProfilePayload): Promise<...>
```

Do not bury identity inside the current `verifyProofWithBackend()` without renaming, because then the function name stops matching the business action.

## 14. Data retention and privacy rules

This integration will fail its privacy goal if you keep raw Aadhaar payloads around.

Recommended rules:

- Never store raw Aadhaar data on-chain
- Do not persist full Aadhaar payload in long-lived application storage
- Persist only:
  - request ID
  - claim hashes
  - derived boolean flags
  - timestamps
  - proof commitments
  - verification mode
- Redact or disable raw identity logs in production

## 15. Failure handling

You need explicit user-facing states for:

- DigiLocker request created but not completed
- DigiLocker authentication failed
- Aadhaar claim invalid
- AlgoPlonk malformed proof
- AlgoPlonk on-chain verifier unavailable
- Reclaim income proof failed
- Algorand anchor failed

Recommended policy:

- if DigiLocker identity fails, stop immediately
- if AlgoPlonk proof fails, stop immediately
- if Reclaim proof fails, stop immediately
- if final Algorand anchor fails, report verification incomplete even if off-chain checks passed

Do not allow a worker into a lender-visible verified state unless the final anchor succeeds.

## 16. Integration roadmap

## Phase 1: Off-chain identity integration

Goal:

- connect wallet
- create DigiLocker request
- derive claims
- verify AlgoPlonk off-chain
- gate Reclaim flow

Deliverables:

- new identity backend routes
- new Acre frontend identity step
- claim hash generation
- off-chain proof validation

## Phase 2: Combined decision engine

Goal:

- combine identity features and income features in backend
- produce Blue Score / eligibility result

Deliverables:

- scoring module
- combined verify endpoint
- richer frontend success state

## Phase 3: On-chain identity anchoring

Goal:

- anchor identity result on Algorand
- either extend Acre contract or add separate identity app

Deliverables:

- new ABI method(s)
- backend app-call integration
- lender-facing read path updates

## Phase 4: Optional on-chain AlgoPlonk verification

Goal:

- route proof verification through dedicated verifier app

Deliverables:

- verifier contract deployment
- env config
- strict mode enablement

## 17. Minimal recommended env set for Acre

Frontend:

```env
VITE_BACKEND_VERIFY_URL=http://localhost:3001/verify-worker-profile
VITE_RECLAIM_APP_ID=
VITE_RECLAIM_APP_SECRET=
VITE_RECLAIM_PROVIDER_ID=
```

Backend:

```env
PORT=3001

ALGOD_SERVER=https://testnet-api.algonode.cloud
ALGOD_TOKEN=
APP_ID=
VERIFIER_MNEMONIC=

ACRE_DIGILOCKER_BASE_URL=https://dg-sandbox.setu.co
ACRE_DIGILOCKER_REDIRECT_URL=http://localhost:8080/digi
http://localhost:5173/identity/callback
ACRE_DIGILOCKER_CLIENT_ID=
ACRE_DIGILOCKER_CLIENT_SECRET=
ACRE_DIGILOCKER_PRODUCT_INSTANCE_ID=
ACRE_DIGILOCKER_TIMEOUT_SECONDS=15

ACRE_ALGOPLONK_VERIFY_APP_ID=
ACRE_ALGOPLONK_VERIFY_METHOD_SIGNATURE=verify(byte[32][],byte[32][])bool
ACRE_ALGOPLONK_REQUIRE_ONCHAIN_VERIFY=false
ACRE_ALGOPLONK_SIMULATE_ONLY=false
```

## 18. Recommended final architecture for Acre

Use this as the clean mental model:

```text
[ Wallet Connected ]
        |
        v
[ DigiLocker Consent ]
        |
        v
[ Derived Identity Claims ]
        |
        v
[ Claim Hashes ]
        |
        v
[ AlgoPlonk Proof Validation ]
        |
        +------> if invalid: reject
        |
        v
[ Reclaim Income Proof ]
        |
        +------> if invalid: reject
        |
        v
[ Acre Feature Engine ]
        |
        v
[ Blue Score + Eligibility ]
        |
        v
[ Algorand Final Anchor ]
        |
        v
[ Lender Query / Decision ]
```

## 19. Practical recommendation

For Acre, the correct first implementation is:

1. add DigiLocker as a wallet-bound identity pre-check,
2. derive only boolean identity claims,
3. validate AlgoPlonk off-chain first,
4. keep Reclaim as the income layer,
5. combine both in one backend decision flow,
6. then extend or split the Algorand contract once the off-chain behavior is stable.

That sequence keeps the system understandable and reduces the chance that you overcomplicate the contract before the product flow is proven.

