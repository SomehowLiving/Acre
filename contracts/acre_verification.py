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


class UserProfile(abi.NamedTuple):
    verified: abi.Field[abi.Uint8]
    tier: abi.Field[abi.Uint8]
    credit_limit: abi.Field[abi.Uint64]
    timestamp: abi.Field[abi.Uint64]
    rider_count: abi.Field[abi.Uint64]
    rider_rating: abi.Field[abi.Uint64]
    platform: abi.Field[abi.String]

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
    platform: abi.String
) -> Expr:
    """
    Store income verification data from Reclaim proof.
    
    Args:
        user_wallet: The gig worker's Algorand address
        tier: Income tier (1=<25k limit, 2=25-50k, 3=>50k)
        credit_limit: Maximum loan amount in rupees
        timestamp: Unix timestamp of verification
        proof_hash: SHA256 hash of Reclaim proof (prevents replay)
        rider_count: Total Uber rides (activity signal)
        rider_rating: Rating * 100 (485 = 4.85 stars)
        platform: "uber", "lyft", etc.
    
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
    
    return Seq([
        # Validate
        Assert(is_verifier, comment="Only verifier can submit proofs"),
        Assert(user_opted_in, comment="User must opt in first"),
        
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
        
        # Increment global proof counter
        App.globalPut(
            GS_PROOF_COUNT,
            App.globalGet(GS_PROOF_COUNT) + Int(1)
        ),
        
        # Emit event for subgraph/indexers
        Log(Concat(
            Bytes("VERIFIED|"),
            user_wallet.get(),
            Bytes("|tier|"),
            Itob(tier.get()),
            Bytes("|limit|"),
            Itob(credit_limit.get()),
            Bytes("|rides|"),
            Itob(rider_count.get()),
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
    Returns tuple: (verified, tier, limit, timestamp, rides, rating, platform)
    """
    opted_in = App.optedIn(user.get(), Global.current_application_id())

    verified = abi.Uint8()
    tier = abi.Uint8()
    credit_limit = abi.Uint64()
    timestamp = abi.Uint64()
    rider_count = abi.Uint64()
    rider_rating = abi.Uint64()
    platform = abi.String()

    return Seq(
        verified.set(If(opted_in).Then(App.localGet(user.get(), LS_VERIFIED)).Else(Int(0))),
        tier.set(If(opted_in).Then(App.localGet(user.get(), LS_TIER)).Else(Int(0))),
        credit_limit.set(If(opted_in).Then(App.localGet(user.get(), LS_CREDIT_LIMIT)).Else(Int(0))),
        timestamp.set(If(opted_in).Then(App.localGet(user.get(), LS_TIMESTAMP)).Else(Int(0))),
        rider_count.set(If(opted_in).Then(App.localGet(user.get(), LS_RIDER_COUNT)).Else(Int(0))),
        rider_rating.set(If(opted_in).Then(App.localGet(user.get(), LS_RIDER_RATING)).Else(Int(0))),
        platform.set(If(opted_in).Then(App.localGet(user.get(), LS_PLATFORM)).Else(Bytes("none"))),
        output.set(verified, tier, credit_limit, timestamp, rider_count, rider_rating, platform),
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
