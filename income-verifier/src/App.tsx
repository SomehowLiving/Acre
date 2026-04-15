import { useCallback, useEffect, useMemo, useState } from 'react'
import type { FormEvent } from 'react'
import { PeraWalletConnect } from '@perawallet/connect'
import { QRCodeSVG } from 'qrcode.react'
import algosdk from 'algosdk'
import './App.css'

type VerifyResponse = {
  success: boolean
  tier: number
  creditLimit: number
  txId: string
  message?: string
}

type ProofPayload = unknown

type Profile = {
  verified: boolean
  tier: string
  creditLimit: string
  timestamp: string
  riderCount: string
  riderRating: string
  platform: string
}

type WalletTxnSigner = (txns: algosdk.Transaction[]) => Promise<Uint8Array[]>

const peraWallet = new PeraWalletConnect()

function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address
  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

function createAlgodClient(server: string, token: string): algosdk.Algodv2 {
  return new algosdk.Algodv2(token, server, '')
}

async function isUserOptedIntoApp(algodClient: algosdk.Algodv2, walletAddress: string, appId: number): Promise<boolean> {
  try {
    await algodClient.accountApplicationInformation(walletAddress, appId).do()
    return true
  } catch {
    return false
  }
}

async function optInToApp(
  algodClient: algosdk.Algodv2,
  walletAddress: string,
  appId: number,
  signTransactions: WalletTxnSigner
): Promise<void> {
  const suggestedParams = await algodClient.getTransactionParams().do()
  const optInTxn = algosdk.makeApplicationOptInTxnFromObject({
    sender: walletAddress,
    appIndex: appId,
    suggestedParams,
  })
  const signed = await signTransactions([optInTxn])
  const sendResult = await algodClient.sendRawTransaction(signed[0]).do()
  await algosdk.waitForConfirmation(algodClient, sendResult.txid, 4)
}

async function generateProof(
  appId: string,
  appSecret: string,
  providerId: string,
  walletAddress: string,
  onRequestUrl: (url: string) => void
): Promise<ProofPayload> {
  const { ReclaimProofRequest } = await import('@reclaimprotocol/js-sdk')
  const reclaim = await ReclaimProofRequest.init(appId, appSecret, providerId)
  reclaim.setContext(walletAddress, 'acre-verification')
  const requestUrl = await reclaim.getRequestUrl()
  onRequestUrl(requestUrl)

  return new Promise((resolve, reject) => {
    reclaim
      .startSession({
        onSuccess: (proofPayload: unknown) => resolve(Array.isArray(proofPayload) ? proofPayload[0] : proofPayload),
        onError: (err: unknown) => reject(err instanceof Error ? err : new Error('Proof session failed')),
      })
      .catch((err: unknown) => reject(err instanceof Error ? err : new Error('Failed to start proof session')))
  })
}

async function verifyWithBackend(endpoint: string, proof: ProofPayload, walletAddress: string): Promise<VerifyResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof, walletAddress }),
  })
  const body = await response.json().catch(() => ({ message: 'Invalid JSON response from backend' }))
  if (!response.ok || !body.success) throw new Error(body.message || 'Verification failed')
  return body as VerifyResponse
}

async function apiGet(baseUrl: string, path: string) {
  const response = await fetch(`${baseUrl}${path}`)
  const body = await response.json().catch(() => ({ message: 'Invalid JSON response' }))
  if (!response.ok || body.success === false) throw new Error(body.message || `Failed request: ${path}`)
  return body
}

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [requestUrl, setRequestUrl] = useState('')
  const [step, setStep] = useState<'idle' | 'proof' | 'verifying'>('idle')
  const [verifyResult, setVerifyResult] = useState<VerifyResponse | null>(null)

  const [profile, setProfile] = useState<Profile | null>(null)
  const [verified, setVerified] = useState<boolean | null>(null)
  const [eligibility, setEligibility] = useState<string>('0')
  const [creditLimit, setCreditLimit] = useState<string>('0')

  const [admin, setAdmin] = useState<string>('')
  const [verifier, setVerifier] = useState<string>('')
  const [proofCount, setProofCount] = useState<string>('0')
  const [newVerifier, setNewVerifier] = useState('')

  const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID as string | undefined
  const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET as string | undefined
  const PROVIDER_ID = import.meta.env.VITE_RECLAIM_PROVIDER_ID as string | undefined
  const BACKEND_VERIFY_URL = import.meta.env.VITE_BACKEND_VERIFY_URL as string | undefined
  const ALGORAND_APP_ID = import.meta.env.VITE_ALGORAND_APP_ID as string | undefined
  const ALGOD_SERVER = (import.meta.env.VITE_ALGOD_SERVER as string | undefined) || 'https://testnet-api.algonode.cloud'
  const ALGOD_TOKEN = (import.meta.env.VITE_ALGOD_TOKEN as string | undefined) || ''

  const backendBaseUrl = useMemo(() => {
    if (!BACKEND_VERIFY_URL) return ''
    return BACKEND_VERIFY_URL.replace(/\/verify-proof\/?$/, '')
  }, [BACKEND_VERIFY_URL])

  const refreshAdminPanel = useCallback(async () => {
    if (!backendBaseUrl) return
    const [adminRes, verifierRes, proofCountRes] = await Promise.all([
      apiGet(backendBaseUrl, '/api/admin'),
      apiGet(backendBaseUrl, '/api/verifier'),
      apiGet(backendBaseUrl, '/api/proof-count'),
    ])
    setAdmin(adminRes.admin || '')
    setVerifier(verifierRes.verifier || '')
    setProofCount(String(proofCountRes.proofCount || '0'))
  }, [backendBaseUrl])

  const refreshUserDashboard = useCallback(async (address: string) => {
    if (!backendBaseUrl || !address) return
    const [profileRes, verifiedRes, eligibilityRes, creditLimitRes] = await Promise.all([
      apiGet(backendBaseUrl, `/api/user/${address}/full-profile`),
      apiGet(backendBaseUrl, `/api/user/${address}/verified`),
      apiGet(backendBaseUrl, `/api/user/${address}/eligibility`),
      apiGet(backendBaseUrl, `/api/user/${address}/credit-limit`),
    ])

    setProfile(profileRes.profile || null)
    setVerified(Boolean(verifiedRes.verified))
    setEligibility(String(eligibilityRes.eligibility || '0'))
    setCreditLimit(String(creditLimitRes.creditLimit || '0'))
  }, [backendBaseUrl])

  useEffect(() => {
    let mounted = true
    ;(async () => {
      try {
        const accounts = await peraWallet.reconnectSession()
        if (mounted && accounts?.length) setAccount(accounts[0])
      } catch {
        if (mounted) setAccount(null)
      }
    })()
    return () => { mounted = false }
  }, [])

  useEffect(() => {
    refreshAdminPanel().catch(() => {})
  }, [refreshAdminPanel])

  useEffect(() => {
    if (!account) {
      setProfile(null)
      setVerified(null)
      setEligibility('0')
      setCreditLimit('0')
      return
    }
    refreshUserDashboard(account).catch((e) => setError(e instanceof Error ? e.message : 'Failed loading dashboard'))
  }, [account, refreshUserDashboard])

  const connectWallet = useCallback(async () => {
    setError(null)
    try {
      const accounts = await peraWallet.connect()
      if (!accounts?.length) throw new Error('No wallet account returned')
      setAccount(accounts[0])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Wallet connection failed')
    }
  }, [])

  const disconnectWallet = useCallback(async () => {
    await peraWallet.disconnect()
    setAccount(null)
    setVerifyResult(null)
    setRequestUrl('')
    setError(null)
    setStep('idle')
  }, [])

  const handleVerify = useCallback(async () => {
    if (!account) return setError('Connect your wallet first')
    if (!APP_ID || !APP_SECRET || !PROVIDER_ID || !BACKEND_VERIFY_URL || !ALGORAND_APP_ID) {
      return setError('Missing required environment configuration')
    }

    setLoading(true)
    setError(null)
    setVerifyResult(null)
    setStep('proof')

    try {
      const appId = Number(ALGORAND_APP_ID)
      if (!Number.isInteger(appId) || appId <= 0) throw new Error('Invalid VITE_ALGORAND_APP_ID')

      const algodClient = createAlgodClient(ALGOD_SERVER, ALGOD_TOKEN)
      const signTransactions: WalletTxnSigner = async (txns) => {
        const txGroup = txns.map((txn) => ({ txn }))
        return peraWallet.signTransaction([txGroup])
      }

      const optedIn = await isUserOptedIntoApp(algodClient, account, appId)
      if (!optedIn) await optInToApp(algodClient, account, appId, signTransactions)

      const proof = await generateProof(APP_ID, APP_SECRET, PROVIDER_ID, account, setRequestUrl)
      setRequestUrl('')
      setStep('verifying')

      const result = await verifyWithBackend(BACKEND_VERIFY_URL, proof, account)
      setVerifyResult(result)
      setStep('idle')

      await Promise.all([refreshUserDashboard(account), refreshAdminPanel()])
    } catch (err) {
      setStep('idle')
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setLoading(false)
    }
  }, [account, APP_ID, APP_SECRET, PROVIDER_ID, BACKEND_VERIFY_URL, ALGORAND_APP_ID, ALGOD_SERVER, ALGOD_TOKEN, refreshUserDashboard, refreshAdminPanel])

  const handleUpdateVerifier = useCallback(async (e: FormEvent) => {
    e.preventDefault()
    if (!backendBaseUrl) return
    setError(null)
    try {
      const response = await fetch(`${backendBaseUrl}/api/update-verifier`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ newVerifier }),
      })
      const body = await response.json().catch(() => ({ message: 'Invalid JSON response' }))
      if (!response.ok || body.success === false) throw new Error(body.message || 'Failed to update verifier')
      setNewVerifier('')
      await refreshAdminPanel()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Update verifier failed')
    }
  }, [backendBaseUrl, newVerifier, refreshAdminPanel])

  const statusLabel = useMemo(() => {
    if (step === 'proof' && requestUrl) return 'Scan the QR with your phone to log in to Uber'
    if (step === 'proof') return 'Generating secure proof request...'
    if (step === 'verifying') return 'Verifying identity & writing to chain...'
    return null
  }, [step, requestUrl])

  return (
    <div className="acre-root">
      <div className="acre-card">
        <h1>Acre Protocol</h1>
        <p>Privacy-preserving income verification for gig workers.</p>
      </div>

      <div className="acre-card">
        <div className="acre-row">
          <div>
            <div className="acre-label">Wallet</div>
            <div className="acre-mono">{account ? truncateAddress(account) : 'Not connected'}</div>
          </div>
          {!account ? (
            <button className="acre-btn-connect" onClick={connectWallet}>Connect Pera Wallet</button>
          ) : (
            <button className="acre-btn-ghost" onClick={disconnectWallet}>Disconnect</button>
          )}
        </div>
      </div>

      <button className="acre-btn-primary" onClick={handleVerify} disabled={!account || loading}>
        {loading ? 'Verifying...' : 'Verify my Uber income'}
      </button>

      {statusLabel && <div className="acre-status-row"><span className="acre-pulse" /><span>{statusLabel}</span></div>}

      {step === 'proof' && requestUrl && (
        <div className="acre-qr-wrap">
          <QRCodeSVG value={requestUrl} size={220} />
        </div>
      )}

      {error && <div className="acre-error">{error}</div>}

      <div className="acre-card">
        <h2>User Dashboard</h2>
        <div className="acre-stat-grid">
          <div className="acre-stat"><div className="acre-label">Verified</div><div>{verified === null ? '-' : verified ? 'Yes' : 'No'}</div></div>
          <div className="acre-stat"><div className="acre-label">Tier</div><div>{profile?.tier ?? '-'}</div></div>
          <div className="acre-stat"><div className="acre-label">Credit Limit</div><div>{profile?.creditLimit ?? '0'}</div></div>
          <div className="acre-stat"><div className="acre-label">Platform</div><div>{profile?.platform ?? '-'}</div></div>
          <div className="acre-stat"><div className="acre-label">Rider Count</div><div>{profile?.riderCount ?? '-'}</div></div>
          <div className="acre-stat"><div className="acre-label">Rider Rating</div><div>{profile?.riderRating ?? '-'}</div></div>
        </div>
      </div>

      <div className="acre-card">
        <h2>Verification Status</h2>
        <p>Eligibility: <strong>{eligibility}</strong></p>
        <p>Credit limit: <strong>{creditLimit}</strong></p>
        {verifyResult?.txId && <p className="acre-mono">Last tx: {verifyResult.txId}</p>}
      </div>

      <div className="acre-card">
        <h2>Admin Panel</h2>
        <p className="acre-mono">Admin: {admin || '-'}</p>
        <p className="acre-mono">Verifier: {verifier || '-'}</p>
        <p>Total proofs: {proofCount}</p>
        <form onSubmit={handleUpdateVerifier} className="acre-form">
          <input
            className="acre-input"
            value={newVerifier}
            onChange={(e) => setNewVerifier(e.target.value)}
            placeholder="New verifier address"
          />
          <button className="acre-btn-primary" type="submit" disabled={!newVerifier}>Update Verifier</button>
        </form>
      </div>
    </div>
  )
}

export default App
