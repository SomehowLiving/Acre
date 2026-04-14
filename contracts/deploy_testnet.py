#!/usr/bin/env python3
"""Build and deploy AcreVerification app to Algorand TestNet."""

from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
from pathlib import Path
from algosdk import mnemonic, transaction, account
from algosdk.logic import get_application_address
from algosdk.v2client.algod import AlgodClient

CONTRACTS_DIR = Path(__file__).resolve().parent
APPROVAL_TEAL = CONTRACTS_DIR / "acre_approval.teal"
CLEAR_TEAL = CONTRACTS_DIR / "acre_clear.teal"
OUTPUT_FILE = CONTRACTS_DIR / "deployed_testnet_app.json"


def require_env(name: str, fallback: str | None = None) -> str:
    value = os.getenv(name) or (os.getenv(fallback) if fallback else None)
    if not value:
        msg = f"Missing required environment variable: {name}"
        if fallback:
            msg += f" (or {fallback})"
        raise RuntimeError(msg)
    return value


def build_contract() -> None:
    cmd = [sys.executable, str(CONTRACTS_DIR / "build.py")]
    result = subprocess.run(cmd, cwd=CONTRACTS_DIR, check=False)
    if result.returncode != 0:
        raise RuntimeError("Contract build failed")


def compile_program(client: AlgodClient, source_path: Path) -> bytes:
    source = source_path.read_text(encoding="utf-8")
    response = client.compile(source)
    return base64.b64decode(response["result"])


def wait_for_confirmation(client: AlgodClient, txid: str, timeout: int = 15) -> dict:
    last_round = client.status()["last-round"]
    for _ in range(timeout):
        pending = client.pending_transaction_info(txid)
        if pending.get("confirmed-round", 0) > 0:
            return pending
        last_round += 1
        client.status_after_block(last_round)
    raise TimeoutError(f"Transaction not confirmed after {timeout} rounds: {txid}")


def main() -> int:
    try:
        build_contract()

        algod_token = require_env("ALGOD_TOKEN", "TESTNET_ALGOD_TOKEN")
        algod_server = require_env("ALGOD_SERVER", "TESTNET_ALGOD_SERVER")
        deployer_mnemonic = require_env("DEPLOYER_MNEMONIC", "TESTNET_DEPLOYER_MNEMONIC")

        client = AlgodClient(algod_token, algod_server)

        private_key = mnemonic.to_private_key(deployer_mnemonic)
        sender = account.address_from_private_key(private_key)
        
        approval_program = compile_program(client, APPROVAL_TEAL)
        clear_program = compile_program(client, CLEAR_TEAL)

        # Matches acre_verification.py:
        # Global: admin(bytes), verifier(bytes), pcnt(uint64)
        global_schema = transaction.StateSchema(num_uints=1, num_byte_slices=2)
        # Local: v,t,l,ts,rc,rr(uint64) + ph,p(bytes)
        local_schema = transaction.StateSchema(num_uints=6, num_byte_slices=2)

        params = client.suggested_params()
        txn = transaction.ApplicationCreateTxn(
            sender=sender,
            sp=params,
            on_complete=transaction.OnComplete.NoOpOC,
            approval_program=approval_program,
            clear_program=clear_program,
            global_schema=global_schema,
            local_schema=local_schema,
        )

        signed_txn = txn.sign(private_key)
        txid = client.send_transaction(signed_txn)
        pending = wait_for_confirmation(client, txid)

        app_id = pending["application-index"]
        app_address = get_application_address(app_id)

        out = {
            "network": "testnet",
            "appId": app_id,
            "appAddress": app_address,
            "creator": sender,
            "txId": txid,
        }
        OUTPUT_FILE.write_text(json.dumps(out, indent=2), encoding="utf-8")

        print("Deployment successful")
        print(f"App ID: {app_id}")
        print(f"App Address: {app_address}")
        print(f"Create TX: {txid}")
        print(f"Saved: {OUTPUT_FILE}")
        return 0

    except Exception as exc:  # pylint: disable=broad-except
        print(f"Deployment failed: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
