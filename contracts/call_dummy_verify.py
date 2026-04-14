#!/usr/bin/env python3
"""Submit a dummy verify_income call to AcreVerification on testnet."""

from __future__ import annotations

import json
import os
import time
from pathlib import Path

from algosdk import account, mnemonic, transaction
from algosdk.abi.contract import Contract
from algosdk.atomic_transaction_composer import (
    AccountTransactionSigner,
    AtomicTransactionComposer,
)
from algosdk.v2client.algod import AlgodClient

BASE_DIR = Path(__file__).resolve().parent
DEPLOY_INFO = BASE_DIR / "deployed_testnet_app.json"
ABI_FILE = BASE_DIR / "acre_abi.json"


def require_env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name) or (os.getenv(fallback) if fallback else None)
    if not value:
        raise RuntimeError(f"Missing env var: {name}" + (f" or {fallback}" if fallback else ""))
    return value


def wait_for_confirmation(client: AlgodClient, txid: str, timeout: int = 20) -> dict:
    last_round = client.status()["last-round"]
    for _ in range(timeout):
        pending = client.pending_transaction_info(txid)
        if pending.get("confirmed-round", 0) > 0:
            return pending
        last_round += 1
        client.status_after_block(last_round)
    raise TimeoutError(f"Not confirmed in {timeout} rounds: {txid}")


def ensure_opted_in(client: AlgodClient, sender: str, signer: AccountTransactionSigner, app_id: int) -> None:
    try:
        info = client.account_application_info(sender, app_id)
        if info and info.get("app-local-state"):
            return
    except Exception:
        pass

    sp = client.suggested_params()
    optin_txn = transaction.ApplicationOptInTxn(sender=sender, sp=sp, index=app_id)
    txid = client.send_transaction(optin_txn.sign(signer.private_key))
    wait_for_confirmation(client, txid)
    print(f"Opt-in tx confirmed: {txid}")


def main() -> int:
    algod_token = require_env("ALGOD_TOKEN", "TESTNET_ALGOD_TOKEN")
    algod_server = require_env("ALGOD_SERVER", "TESTNET_ALGOD_SERVER")
    deployer_mn = require_env("DEPLOYER_MNEMONIC", "TESTNET_DEPLOYER_MNEMONIC")

    app_id = json.loads(DEPLOY_INFO.read_text(encoding="utf-8"))["appId"]
    contract = Contract.undictify(json.loads(ABI_FILE.read_text(encoding="utf-8")))

    client = AlgodClient(algod_token, algod_server)
    private_key = mnemonic.to_private_key(deployer_mn)
    sender = account.address_from_private_key(private_key)
    signer = AccountTransactionSigner(private_key)

    ensure_opted_in(client, sender, signer, app_id)

    method = contract.get_method_by_name("verify_income")

    # 32-byte proof hash from dummy string
    proof_hash_bytes = b"dummy-proof-v1".ljust(32, b"\x00")

    atc = AtomicTransactionComposer()
    sp = client.suggested_params()
    atc.add_method_call(
        app_id=app_id,
        method=method,
        sender=sender,
        sp=sp,
        signer=signer,
        method_args=[
            sender,                 # user_wallet
            2,                      # tier
            25000,                  # credit_limit
            int(time.time()),       # timestamp
            proof_hash_bytes,       # proof_hash (bytes32)
            321,                    # rider_count
            478,                    # rider_rating (4.78 * 100)
            "uber",                # platform
        ],
    )

    result = atc.execute(client, 4)
    txid = result.tx_ids[0]
    pending = client.pending_transaction_info(txid)

    out = {
        "appId": app_id,
        "sender": sender,
        "txId": txid,
        "confirmedRound": pending.get("confirmed-round"),
        "dummyArgs": {
            "tier": 2,
            "credit_limit": 25000,
            "rider_count": 321,
            "rider_rating": 478,
            "platform": "uber",
        },
    }
    (BASE_DIR / "dummy_verify_result.json").write_text(json.dumps(out, indent=2), encoding="utf-8")

    print("verify_income sent")
    print(f"App ID: {app_id}")
    print(f"Sender/User: {sender}")
    print(f"Tx ID: {txid}")
    print("Saved: dummy_verify_result.json")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
