from pyteal import *
from pyteal.ast.router import Router
from typing import Literal

# ==========================================
# STATE KEYS
# ==========================================

# Global State (contract-level)
GS_ADMIN = Bytes("admin")           # Contract creator
GS_VERIFIER = Bytes("verifier")     # Backend wallet that can verify
GS_PROOF_COUNT = Bytes("pcnt")      # Total proofs stored (for tracking)

# Local State (per user wallet)
LS_VERIFIED = Bytes("v")            # uint8: 0 or 1
LS_TIER = Bytes("t")                # uint8: 1, 2, or 3
LS_CREDIT_LIMIT = Bytes("l")        # uint64: credit limit in rupees
LS_TIMESTAMP = Bytes("ts")          # uint64: unix timestamp
LS_PROOF_HASH = Bytes("ph")         # bytes[32]: hash of reclaim proof
LS_RIDER_COUNT = Bytes("rc")        # uint64: total uber rides
LS_RIDER_RATING = Bytes("rr")       # uint64: rating * 100 (4.85 = 485)
LS_PLATFORM = Bytes("p")            # bytes: "uber", "lyft", etc.
LS_SCORE = Bytes("sc")              # uint16-compatible: Blue Score 0-1000
LS_BUCKETS = Bytes("bk")            # packed uint64: income|tenure|completion|rating buckets
LS_SOURCE = Bytes("src")            # bytes: "reclaim" or "fallback"
LS_PLAUSIBILITY_FLAGS = Bytes("pf") # uint8-compatible bitmask
LS_MONTHLY_EARNINGS = Bytes("me")   # uint64: monthly earnings in rupees
LS_TENURE_MONTHS = Bytes("tm")      # uint64: actual platform tenure in months
LS_COMPLETION_RATE = Bytes("cr")    # uint64: completion rate * 100 (96% = 9600)


class UserProfile(abi.NamedTuple):
    verified: abi.Field[abi.Uint8]
    tier: abi.Field[abi.Uint8]
    credit_limit: abi.Field[abi.Uint64]
    timestamp: abi.Field[abi.Uint64]
    rider_count: abi.Field[abi.Uint64]
    rider_rating: abi.Field[abi.Uint64]
    platform: abi.Field[abi.String]
    score: abi.Field[abi.Uint16]
    buckets: abi.Field[abi.Uint64]
    source: abi.Field[abi.String]
    plausibility_flags: abi.Field[abi.Uint8]
    monthly_earnings: abi.Field[abi.Uint64]
    tenure_months: abi.Field[abi.Uint64]
    completion_rate: abi.Field[abi.Uint64]


class ScoreBreakdown(abi.NamedTuple):
    income_bucket: abi.Field[abi.Uint8]
    tenure_bucket: abi.Field[abi.Uint8]
    completion_bucket: abi.Field[abi.Uint8]
    rating_bucket: abi.Field[abi.Uint8]

# ==========================================
# ROUTER SETUP
# ==========================================

router = Router(
    "AcreVerification",
    BareCallActions(
        no_op=OnCompleteAction.create_only(Seq([
            App.globalPut(GS_ADMIN, Txn.sender()),
            App.globalPut(GS_VERIFIER, Txn.sender()),  # Initially admin is verifier
            App.globalPut(GS_PROOF_COUNT, Int(0)),
            Approve()
        ])),
        opt_in=OnCompleteAction.always(Approve()),
    ),
    clear_state=Approve()
)

# ==========================================
# ADMIN FUNCTIONS
# ==========================================

@router.method
def update_verifier(new_verifier: abi.Address) -> Expr:
    """
    Change the backend verifier address.
    Only admin can call this.
    """
    return Seq([
        Assert(
            Txn.sender() == App.globalGet(GS_ADMIN),
            comment="Only admin can update verifier"
        ),
        App.globalPut(GS_VERIFIER, new_verifier.get()),
        Log(Concat(Bytes("VERIFIER_UPDATED:"), new_verifier.get()))
    ])

# ==========================================
# CORE VERIFICATION FUNCTION
# ==========================================

@router.method
def verify_income(
    user_wallet: abi.Address,
    tier: abi.Uint8,
    credit_limit: abi.Uint64,
    timestamp: abi.Uint64,
    proof_hash: abi.StaticBytes[Literal[32]],
    rider_count: abi.Uint64,
    rider_rating: abi.Uint64,  # multiplied by 100 (4.85 = 485)
    platform: abi.String,
    score: abi.Uint16,
    income_bucket: abi.Uint8,
    tenure_bucket: abi.Uint8,
    completion_bucket: abi.Uint8,
    rating_bucket: abi.Uint8,
    source: abi.String,
    plausibility_flags: abi.Uint8,
    monthly_earnings: abi.Uint64,
    tenure_months: abi.Uint64,
    completion_rate: abi.Uint64
) -> Expr:
    """
    Store income verification data and the full Blue Score audit record.
    
    Args:
        user_wallet: The gig worker's Algorand address
        tier: Income tier (1=<25k limit, 2=25-50k, 3=>50k)
        credit_limit: Maximum loan amount in rupees
        timestamp: Unix timestamp of verification
        proof_hash: SHA256 hash of Reclaim proof (prevents replay)
        rider_count: Total Uber rides (activity signal)
        rider_rating: Rating * 100 (485 = 4.85 stars)
        platform: "uber", "lyft", etc.
        score: Blue Score, 0-1000
        income_bucket: 1=<20k, 2=20-35k, 3=35-50k, 4=>50k
        tenure_bucket: 1=<6mo, 2=6-12mo, 3=12-24mo, 4=>24mo
        completion_bucket: 1=<85%, 2=85-92%, 3=92-97%, 4=>97%
        rating_bucket: 1=<4.0, 2=4.0-4.5, 3=4.5-4.8, 4=>4.8
        source: "reclaim" or "fallback"
        plausibility_flags: bitmask, 0 means clean
        monthly_earnings: monthly earnings in rupees
        tenure_months: actual platform tenure in months
        completion_rate: completion rate * 100 (9600 = 96%)
    
    Only callable by designated verifier (backend).
    User must have opted into contract.
    """
    
    # Authorization: Only verifier can submit
    is_verifier = Txn.sender() == App.globalGet(GS_VERIFIER)
    
    # User must have opted in
    user_opted_in = App.optedIn(
        user_wallet.get(), 
        Global.current_application_id()
    )
    
    # Check if this is a re-verification (update vs new)
    existing_timestamp = App.localGet(user_wallet.get(), LS_TIMESTAMP)
    is_update = existing_timestamp > Int(0)
    
    # New timestamp must be newer (prevent backdating)
    is_fresh = timestamp.get() > existing_timestamp
    packed_buckets = (
        income_bucket.get() * Int(16777216) +
        tenure_bucket.get() * Int(65536) +
        completion_bucket.get() * Int(256) +
        rating_bucket.get()
    )
    
    return Seq([
        # Validate
        Assert(is_verifier, comment="Only verifier can submit proofs"),
        Assert(user_opted_in, comment="User must opt in first"),
        Assert(And(tier.get() >= Int(1), tier.get() <= Int(3)), comment="tier out of range"),
        Assert(score.get() <= Int(1000), comment="score out of range"),
        Assert(And(income_bucket.get() >= Int(1), income_bucket.get() <= Int(4)), comment="income bucket out of range"),
        Assert(And(tenure_bucket.get() >= Int(1), tenure_bucket.get() <= Int(4)), comment="tenure bucket out of range"),
        Assert(And(completion_bucket.get() >= Int(1), completion_bucket.get() <= Int(4)), comment="completion bucket out of range"),
        Assert(And(rating_bucket.get() >= Int(1), rating_bucket.get() <= Int(4)), comment="rating bucket out of range"),
        Assert(completion_rate.get() <= Int(10000), comment="completion rate out of range"),
        
        # If updating, ensure timestamp is newer
        If(is_update).Then(
            Assert(is_fresh, comment="New timestamp must be newer")
        ),
        
        # Store all verification data
        App.localPut(user_wallet.get(), LS_VERIFIED, Int(1)),
        App.localPut(user_wallet.get(), LS_TIER, tier.get()),
        App.localPut(user_wallet.get(), LS_CREDIT_LIMIT, credit_limit.get()),
        App.localPut(user_wallet.get(), LS_TIMESTAMP, timestamp.get()),
        App.localPut(user_wallet.get(), LS_PROOF_HASH, proof_hash.get()),
        App.localPut(user_wallet.get(), LS_RIDER_COUNT, rider_count.get()),
        App.localPut(user_wallet.get(), LS_RIDER_RATING, rider_rating.get()),
        App.localPut(user_wallet.get(), LS_PLATFORM, platform.get()),
        App.localPut(user_wallet.get(), LS_SCORE, score.get()),
        App.localPut(user_wallet.get(), LS_BUCKETS, packed_buckets),
        App.localPut(user_wallet.get(), LS_SOURCE, source.get()),
        App.localPut(user_wallet.get(), LS_PLAUSIBILITY_FLAGS, plausibility_flags.get()),
        App.localPut(user_wallet.get(), LS_MONTHLY_EARNINGS, monthly_earnings.get()),
        App.localPut(user_wallet.get(), LS_TENURE_MONTHS, tenure_months.get()),
        App.localPut(user_wallet.get(), LS_COMPLETION_RATE, completion_rate.get()),
        
        # Increment global proof counter
        App.globalPut(
            GS_PROOF_COUNT,
            App.globalGet(GS_PROOF_COUNT) + Int(1)
        ),
        
        # Emit event for subgraph/indexers
        Log(Concat(
            Bytes("VERIFIED|"),
            user_wallet.get(),
            Bytes("|score|"),
            Itob(score.get()),
            Bytes("|tier|"),
            Itob(tier.get()),
            Bytes("|limit|"),
            Itob(credit_limit.get()),
            Bytes("|rides|"),
            Itob(rider_count.get()),
            Bytes("|buckets|"),
            Itob(packed_buckets),
            Bytes("|plausibility|"),
            Itob(plausibility_flags.get()),
            Bytes("|platform|"),
            platform.get()
        ))
    ])

# ==========================================
# VIEW FUNCTIONS FOR LENDERS
# ==========================================

@router.method
def get_eligibility(user: abi.Address, *, output: abi.Uint64) -> Expr:
    """
    Returns credit limit for a user.
    Returns 0 if not verified.
    """
    is_verified = App.localGet(user.get(), LS_VERIFIED)
    credit_limit = App.localGet(user.get(), LS_CREDIT_LIMIT)
    
    return output.set(
        If(And(
            App.optedIn(user.get(), Global.current_application_id()),
            is_verified == Int(1)
        ))
        .Then(credit_limit)
        .Else(Int(0))
    )

@router.method
def is_verified(user: abi.Address, *, output: abi.Uint8) -> Expr:
    """
    Check if user has verified income.
    Returns: 1 = verified, 0 = not verified
    """
    return output.set(
        If(App.optedIn(user.get(), Global.current_application_id()))
        .Then(App.localGet(user.get(), LS_VERIFIED))
        .Else(Int(0))
    )

@router.method
def get_tier(user: abi.Address, *, output: abi.Uint8) -> Expr:
    """
    Get income tier (1, 2, or 3).
    Returns 0 if not verified.
    """
    return output.set(
        If(App.optedIn(user.get(), Global.current_application_id()))
        .Then(App.localGet(user.get(), LS_TIER))
        .Else(Int(0))
    )

@router.method
def get_credit_limit(user: abi.Address, *, output: abi.Uint64) -> Expr:
    """
    Get credit limit in rupees.
    Alias for get_eligibility.
    """
    is_verified = App.localGet(user.get(), LS_VERIFIED)
    limit = App.localGet(user.get(), LS_CREDIT_LIMIT)
    
    return output.set(
        If(And(
            App.optedIn(user.get(), Global.current_application_id()),
            is_verified == Int(1)
        ))
        .Then(limit)
        .Else(Int(0))
    )


@router.method
def get_full_profile(user: abi.Address, *, output: UserProfile) -> Expr:
    """
    Get all verification details at once.
    Returns tuple:
    (verified, tier, limit, timestamp, rides, rating, platform,
     score, buckets, source, plausibility_flags, monthly_earnings,
     tenure_months, completion_rate)
    """
    opted_in = App.optedIn(user.get(), Global.current_application_id())

    verified = abi.Uint8()
    tier = abi.Uint8()
    credit_limit = abi.Uint64()
    timestamp = abi.Uint64()
    rider_count = abi.Uint64()
    rider_rating = abi.Uint64()
    platform = abi.String()
    score = abi.Uint16()
    buckets = abi.Uint64()
    source = abi.String()
    plausibility_flags = abi.Uint8()
    monthly_earnings = abi.Uint64()
    tenure_months = abi.Uint64()
    completion_rate = abi.Uint64()

    return Seq(
        verified.set(If(opted_in).Then(App.localGet(user.get(), LS_VERIFIED)).Else(Int(0))),
        tier.set(If(opted_in).Then(App.localGet(user.get(), LS_TIER)).Else(Int(0))),
        credit_limit.set(If(opted_in).Then(App.localGet(user.get(), LS_CREDIT_LIMIT)).Else(Int(0))),
        timestamp.set(If(opted_in).Then(App.localGet(user.get(), LS_TIMESTAMP)).Else(Int(0))),
        rider_count.set(If(opted_in).Then(App.localGet(user.get(), LS_RIDER_COUNT)).Else(Int(0))),
        rider_rating.set(If(opted_in).Then(App.localGet(user.get(), LS_RIDER_RATING)).Else(Int(0))),
        platform.set(If(opted_in).Then(App.localGet(user.get(), LS_PLATFORM)).Else(Bytes("none"))),
        score.set(If(opted_in).Then(App.localGet(user.get(), LS_SCORE)).Else(Int(0))),
        buckets.set(If(opted_in).Then(App.localGet(user.get(), LS_BUCKETS)).Else(Int(0))),
        source.set(If(opted_in).Then(App.localGet(user.get(), LS_SOURCE)).Else(Bytes("none"))),
        plausibility_flags.set(If(opted_in).Then(App.localGet(user.get(), LS_PLAUSIBILITY_FLAGS)).Else(Int(0))),
        monthly_earnings.set(If(opted_in).Then(App.localGet(user.get(), LS_MONTHLY_EARNINGS)).Else(Int(0))),
        tenure_months.set(If(opted_in).Then(App.localGet(user.get(), LS_TENURE_MONTHS)).Else(Int(0))),
        completion_rate.set(If(opted_in).Then(App.localGet(user.get(), LS_COMPLETION_RATE)).Else(Int(0))),
        output.set(
            verified,
            tier,
            credit_limit,
            timestamp,
            rider_count,
            rider_rating,
            platform,
            score,
            buckets,
            source,
            plausibility_flags,
            monthly_earnings,
            tenure_months,
            completion_rate,
        ),
    )


@router.method
def get_score(user: abi.Address, *, output: abi.Uint16) -> Expr:
    """Get Blue Score (0-1000). Returns 0 if not verified."""
    return output.set(
        If(App.optedIn(user.get(), Global.current_application_id()))
        .Then(App.localGet(user.get(), LS_SCORE))
        .Else(Int(0))
    )


@router.method
def get_score_breakdown(user: abi.Address, *, output: ScoreBreakdown) -> Expr:
    """Get score buckets: income, tenure, completion, rating."""
    opted_in = App.optedIn(user.get(), Global.current_application_id())
    buckets = If(opted_in).Then(App.localGet(user.get(), LS_BUCKETS)).Else(Int(0))
    income_bucket = abi.Uint8()
    tenure_bucket = abi.Uint8()
    completion_bucket = abi.Uint8()
    rating_bucket = abi.Uint8()

    return Seq(
        income_bucket.set(buckets / Int(16777216)),
        tenure_bucket.set((buckets / Int(65536)) % Int(256)),
        completion_bucket.set((buckets / Int(256)) % Int(256)),
        rating_bucket.set(buckets % Int(256)),
        output.set(income_bucket, tenure_bucket, completion_bucket, rating_bucket),
    )


@router.method
def get_source(user: abi.Address, *, output: abi.String) -> Expr:
    """Get verification source: reclaim, fallback, onchain_derived, etc."""
    return output.set(
        If(App.optedIn(user.get(), Global.current_application_id()))
        .Then(App.localGet(user.get(), LS_SOURCE))
        .Else(Bytes("none"))
    )


@router.method
def has_plausibility_issues(user: abi.Address, *, output: abi.Uint8) -> Expr:
    """Returns 1 if plausibility flags > 0."""
    opted_in = App.optedIn(user.get(), Global.current_application_id())
    flags = App.localGet(user.get(), LS_PLAUSIBILITY_FLAGS)

    return output.set(
        If(And(opted_in, flags > Int(0)))
        .Then(Int(1))
        .Else(Int(0))
    )

@router.method
def get_proof_hash(user: abi.Address, *, output: abi.StaticBytes[Literal[32]]) -> Expr:
    """
    Get the hash of the Reclaim proof used for verification.
    Returns empty bytes if not verified.
    """
    return output.set(
        If(App.optedIn(user.get(), Global.current_application_id()))
        .Then(App.localGet(user.get(), LS_PROOF_HASH))
        .Else(BytesZero(Int(32)))
    )

# ==========================================
# UTILITY FUNCTIONS
# ==========================================

@router.method
def get_verifier(*, output: abi.Address) -> Expr:
    """Returns the current verifier address."""
    return output.set(App.globalGet(GS_VERIFIER))

@router.method
def get_admin(*, output: abi.Address) -> Expr:
    """Returns the admin address."""
    return output.set(App.globalGet(GS_ADMIN))

@router.method
def get_proof_count(*, output: abi.Uint64) -> Expr:
    """Returns total number of proofs stored."""
    return output.set(App.globalGet(GS_PROOF_COUNT))

# ==========================================
# COMPILE
# ==========================================

if __name__ == "__main__":
    approval_program, clear_program, contract_interface = router.compile_program(
        version=8,
        assemble_constants=True,
    )
    
    # Save to files
    with open("acre_approval.teal", "w") as f:
        f.write(approval_program)
    
    with open("acre_clear.teal", "w") as f:
        f.write(clear_program)
    
    # Save ABI JSON for frontend
    import json
    with open("acre_abi.json", "w") as f:
        json.dump(contract_interface.dictify(), f, indent=2)
    
    print("✅ Contract compiled!")
    print(f"Approval: {len(approval_program)} bytes")
    print(f"Clear: {len(clear_program)} bytes")
    print(f"Methods: {len(contract_interface.methods)}")
