import { useCallback, useEffect, useMemo, useState } from 'react'
import { PeraWalletConnect } from '@perawallet/connect'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'

// ─── Types ───────────────────────────────────────────────────────────────────

type VerifyResponse = {
  success: boolean
  tier: number
  creditLimit: number
  txId: string
  driverData?: {
    tripsCompleted: number
    driverRating: number
    accountAgeMonths: number
    weeklyEarnings: number
    monthlyEarnings: number
  }
  creditReason?: string
  message?: string
}

type ProofPayload = unknown

// ─── Constants ───────────────────────────────────────────────────────────────

const peraWallet = new PeraWalletConnect()

// ─── Helpers ─────────────────────────────────────────────────────────────────

function truncateAddress(address: string): string {
  if (!address || address.length < 12) return address
  return `${address.slice(0, 6)}...${address.slice(-6)}`
}

function formatInr(amount: number): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(amount)
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
        onSuccess: (proofPayload: unknown) => {
          const proof = Array.isArray(proofPayload) ? proofPayload[0] : proofPayload
          resolve(proof)
        },
        onError: (err: unknown) => {
          reject(err instanceof Error ? err : new Error('Proof session failed'))
        },
      })
      .catch((err: unknown) => {
        reject(err instanceof Error ? err : new Error('Failed to start proof session'))
      })
  })
}

async function verifyWithBackend(
  endpoint: string,
  proof: ProofPayload,
  walletAddress: string
): Promise<VerifyResponse> {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ proof, walletAddress }),
  })

  let body: VerifyResponse | { message?: string } = { message: 'Unknown error' }
  try {
    body = await response.json()
  } catch {
    body = { message: 'Invalid JSON response from backend' }
  }

  const parsed = body as VerifyResponse
  if (!response.ok || !parsed.success) {
    throw new Error(body.message || 'Verification failed')
  }
  if (!parsed.txId || typeof parsed.txId !== 'string') {
    throw new Error('Backend did not return a valid transaction id')
  }

  return parsed
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div style={styles.statCard}>
      <span style={styles.statLabel}>{label}</span>
      <span style={styles.statValue}>{value}</span>
    </div>
  )
}

// ─── Main App ────────────────────────────────────────────────────────────────

function App() {
  const [account, setAccount] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<VerifyResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [requestUrl, setRequestUrl] = useState('')
  const [step, setStep] = useState<'idle' | 'proof' | 'verifying'>('idle')

  const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID as string | undefined
  const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET as string | undefined
  const PROVIDER_ID = import.meta.env.VITE_RECLAIM_PROVIDER_ID as string | undefined
  const BACKEND_VERIFY_URL = import.meta.env.VITE_BACKEND_VERIFY_URL as string | undefined

  // Reconnect on mount
  useEffect(() => {
    let mounted = true
    const reconnect = async () => {
      try {
        const accounts = await peraWallet.reconnectSession()
        if (!mounted || !accounts?.length) return
        setAccount(accounts[0])
      } catch {
        if (mounted) setAccount(null)
      }
    }
    reconnect()
    return () => { mounted = false }
  }, [])

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
    setResult(null)
    setRequestUrl('')
    setError(null)
    setStep('idle')
  }, [])

  const handleVerify = useCallback(async () => {
    if (!account) { setError('Connect your wallet first'); return }
    if (!APP_ID || !APP_SECRET || !PROVIDER_ID || !BACKEND_VERIFY_URL) {
      setError('Missing required environment configuration')
      return
    }

    setLoading(true)
    setError(null)
    setResult(null)
    setStep('proof')

    try {
      const proof = await generateProof(APP_ID, APP_SECRET, PROVIDER_ID, account, (url) => {
        setRequestUrl(url)
      })
      setRequestUrl('')
      setStep('verifying')
      const verifyResult = await verifyWithBackend(BACKEND_VERIFY_URL, proof, account)
      setResult(verifyResult)
      setStep('idle')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
      setStep('idle')
    } finally {
      setLoading(false)
    }
  }, [APP_ID, APP_SECRET, PROVIDER_ID, BACKEND_VERIFY_URL, account])

  const txExplorerUrl = useMemo(() => {
    if (!result?.txId) return ''
    return `https://lora.algokit.io/testnet/transaction/${result.txId}`
  }, [result?.txId])

  const statusLabel = useMemo(() => {
    if (step === 'proof' && requestUrl) return 'Scan the QR with your phone to log in to Uber'
    if (step === 'proof') return 'Generating secure proof request...'
    if (step === 'verifying') return 'Verifying identity & writing to chain...'
    return null
  }, [step, requestUrl])

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Sora:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap');

        *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

        body {
          background: #f7f6f2;
          min-height: 100vh;
        }

        .acre-root {
          font-family: 'Sora', system-ui, sans-serif;
          max-width: 520px;
          margin: 56px auto 80px;
          padding: 0 20px;
        }

        .acre-card {
          background: #ffffff;
          border: 1px solid #e8e5de;
          border-radius: 20px;
          padding: 28px;
          margin-bottom: 16px;
        }

        .acre-btn-primary {
          width: 100%;
          padding: 15px 20px;
          border-radius: 12px;
          border: none;
          background: #111827;
          color: #fff;
          font-family: 'Sora', system-ui, sans-serif;
          font-size: 15px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.15s, opacity 0.15s;
          letter-spacing: -0.01em;
        }
        .acre-btn-primary:hover:not(:disabled) { background: #1f2937; }
        .acre-btn-primary:disabled { opacity: 0.45; cursor: not-allowed; }

        .acre-btn-ghost {
          padding: 9px 16px;
          border-radius: 8px;
          border: 1px solid #e0ddd5;
          background: transparent;
          color: #374151;
          font-family: 'Sora', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 500;
          cursor: pointer;
          transition: background 0.12s;
          white-space: nowrap;
        }
        .acre-btn-ghost:hover { background: #f3f2ee; }

        .acre-btn-connect {
          padding: 9px 16px;
          border-radius: 8px;
          border: none;
          background: #111827;
          color: #fff;
          font-family: 'Sora', system-ui, sans-serif;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background 0.12s;
          white-space: nowrap;
        }
        .acre-btn-connect:hover { background: #1f2937; }

        .acre-stat-grid {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
        }

        .acre-stat {
          background: #f7f6f2;
          border-radius: 12px;
          padding: 14px 16px;
        }

        .acre-tier-card {
          background: #111827;
          color: #fff;
          border-radius: 16px;
          padding: 24px;
          text-align: center;
          margin-top: 12px;
        }

        .acre-pulse {
          display: inline-block;
          width: 8px;
          height: 8px;
          border-radius: 50%;
          background: #10b981;
          animation: pulse 1.4s ease-in-out infinite;
          margin-right: 8px;
          vertical-align: middle;
        }

        @keyframes pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.4; transform: scale(0.85); }
        }

        .acre-mono {
          font-family: 'DM Mono', monospace;
          font-size: 12px;
          color: #6b7280;
          word-break: break-all;
        }

        .acre-badge {
          display: inline-block;
          padding: 3px 10px;
          border-radius: 20px;
          font-size: 12px;
          font-weight: 500;
        }

        .acre-badge-tier {
          background: rgba(255,255,255,0.12);
          color: rgba(255,255,255,0.8);
          border: 1px solid rgba(255,255,255,0.15);
        }

        .acre-divider {
          border: none;
          border-top: 1px solid #f0ede5;
          margin: 20px 0;
        }

        .acre-error {
          border: 1px solid #fecaca;
          background: #fef2f2;
          color: #991b1b;
          border-radius: 12px;
          padding: 14px 16px;
          font-size: 14px;
          margin-top: 12px;
        }

        .acre-status-row {
          display: flex;
          align-items: center;
          justify-content: center;
          gap: 8px;
          font-size: 14px;
          color: #6b7280;
          margin-top: 16px;
          min-height: 22px;
        }

        .acre-qr-wrap {
          display: flex;
          flex-direction: column;
          align-items: center;
          padding: 28px 20px;
          background: #fff;
          border: 1px solid #e8e5de;
          border-radius: 20px;
          margin-top: 16px;
          gap: 16px;
        }

        .acre-tx-link {
          display: inline-flex;
          align-items: center;
          gap: 6px;
          font-size: 13px;
          color: #2563eb;
          text-decoration: none;
          font-weight: 500;
        }
        .acre-tx-link:hover { text-decoration: underline; }

        .acre-success-icon {
          width: 40px;
          height: 40px;
          border-radius: 50%;
          background: #ecfdf5;
          border: 1px solid #6ee7b7;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 18px;
          flex-shrink: 0;
        }
      `}</style>

      <div className="acre-root">

        {/* ── Header ── */}
        <div style={{ marginBottom: 32 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <div style={{
              width: 36, height: 36, borderRadius: 10,
              background: '#111827', display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: 18
            }}>🚗</div>
            <h1 style={{
              fontFamily: 'Sora, system-ui, sans-serif',
              fontSize: 22, fontWeight: 600, color: '#111827',
              letterSpacing: '-0.02em'
            }}>Acre Protocol</h1>
          </div>
          <p style={{ fontSize: 14, color: '#6b7280', lineHeight: 1.5 }}>
            Privacy-preserving income verification for gig workers.
            Prove your earnings without exposing raw data.
          </p>
        </div>

        {/* ── Wallet Card ── */}
        <div className="acre-card">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <div>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>
                Wallet
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: '#111827', fontFamily: account ? 'DM Mono, monospace' : 'Sora, system-ui, sans-serif' }}>
                {account ? truncateAddress(account) : 'Not connected'}
              </div>
            </div>
            {!account ? (
              <button className="acre-btn-connect" onClick={connectWallet}>
                Connect Pera Wallet
              </button>
            ) : (
              <button className="acre-btn-ghost" onClick={disconnectWallet}>
                Disconnect
              </button>
            )}
          </div>
        </div>

        {/* ── Verify Button ── */}
        <button
          className="acre-btn-primary"
          onClick={handleVerify}
          disabled={!account || loading}
        >
          {loading ? 'Verifying...' : 'Verify my Uber income'}
        </button>

        {/* ── Status row ── */}
        {statusLabel && (
          <div className="acre-status-row">
            <span className="acre-pulse" />
            <span>{statusLabel}</span>
          </div>
        )}

        {/* ── QR Code ── */}
        {step === 'proof' && requestUrl && (
          <div className="acre-qr-wrap">
            <div style={{
              padding: 16, background: '#fff', border: '1px solid #e8e5de',
              borderRadius: 16, lineHeight: 0
            }}>
              <QRCodeSVG value={requestUrl} size={220} />
            </div>
            <p style={{ fontSize: 13, color: '#6b7280', textAlign: 'center', maxWidth: 280 }}>
              Open your phone camera and scan to log in to Uber securely
            </p>
          </div>
        )}

        {/* ── Error ── */}
        {error && <div className="acre-error">{error}</div>}

        {/* ── Result Card ── */}
        {result && (
          <div className="acre-card" style={{ marginTop: 16 }}>

            {/* Verified header */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 20 }}>
              <div className="acre-success-icon">✓</div>
              <div>
                <div style={{ fontWeight: 600, fontSize: 16, color: '#111827' }}>
                  Driver Verified
                </div>
                <div style={{ fontSize: 13, color: '#6b7280', marginTop: 2 }}>
                  Identity confirmed on Algorand TestNet
                </div>
              </div>
            </div>

            {/* Driver stats */}
            {result.driverData && (
              <>
                <div className="acre-stat-grid">
                  <div className="acre-stat">
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Trips completed
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#111827' }}>
                      {result.driverData.tripsCompleted.toLocaleString('en-IN')}
                    </div>
                  </div>
                  <div className="acre-stat">
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Driver rating
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#111827' }}>
                      ★ {result.driverData.driverRating}
                    </div>
                  </div>
                  <div className="acre-stat">
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Weekly earnings
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#111827' }}>
                      {formatInr(result.driverData.weeklyEarnings)}
                    </div>
                  </div>
                  <div className="acre-stat">
                    <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>
                      Account age
                    </div>
                    <div style={{ fontSize: 22, fontWeight: 600, color: '#111827' }}>
                      {result.driverData.accountAgeMonths}mo
                    </div>
                  </div>
                </div>
                <hr className="acre-divider" />
              </>
            )}

            {/* Credit tier */}
            <div className="acre-tier-card">
              <div style={{ marginBottom: 8, display: 'flex', justifyContent: 'center', gap: 8 }}>
                <span className="acre-badge acre-badge-tier">Tier {result.tier}</span>
                {result.creditReason && (
                  <span className="acre-badge acre-badge-tier">{result.creditReason}</span>
                )}
              </div>
              <div style={{ fontSize: 13, color: 'rgba(255,255,255,0.5)', marginBottom: 6 }}>
                Pre-approved loan limit
              </div>
              <div style={{ fontSize: 36, fontWeight: 600, letterSpacing: '-0.03em', color: '#fff' }}>
                {formatInr(result.creditLimit)}
              </div>
            </div>

            {/* Transaction */}
            <hr className="acre-divider" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <div style={{ fontSize: 11, fontWeight: 500, color: '#9ca3af', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                On-chain transaction
              </div>
              <div className="acre-mono">{result.txId}</div>
              {txExplorerUrl && (
                <a href={txExplorerUrl} target="_blank" rel="noreferrer" className="acre-tx-link">
                  View on AlgoExplorer (TestNet) →
                </a>
              )}
            </div>
          </div>
        )}

      </div>
    </>
  )
}

export default App

// import { useCallback, useEffect, useMemo, useState } from 'react'
// import { PeraWalletConnect } from '@perawallet/connect'
// import { QRCodeSVG } from 'qrcode.react'
// import './App.css'

// type VerifyResponse = {
//   success: boolean
//   tier: number
//   creditLimit: number
//   txId: string
//   message?: string
// }

// type ProofPayload = unknown

// const peraWallet = new PeraWalletConnect()

// function truncateAddress(address: string): string {
//   if (!address || address.length < 12) return address
//   return `${address.slice(0, 6)}...${address.slice(-6)}`
// }

// function formatInr(amount: number): string {
//   return new Intl.NumberFormat('en-IN', {
//     style: 'currency',
//     currency: 'INR',
//     maximumFractionDigits: 0,
//   }).format(amount)
// }

// async function generateProof(
//   appId: string,
//   appSecret: string,
//   providerId: string,
//   walletAddress: string,
//   onRequestUrl: (url: string) => void
// ): Promise<ProofPayload> {
//   const { ReclaimProofRequest } = await import('@reclaimprotocol/js-sdk')
//   const reclaim = await ReclaimProofRequest.init(appId, appSecret, providerId)
//   reclaim.setContext(walletAddress, 'acre-verification')
//   const requestUrl = await reclaim.getRequestUrl()
//   onRequestUrl(requestUrl)

//   return new Promise((resolve, reject) => {
//     reclaim
//       .startSession({
//         onSuccess: (proofPayload: unknown) => {
//           const proof = Array.isArray(proofPayload) ? proofPayload[0] : proofPayload
//           resolve(proof)
//         },
//         onError: (err: unknown) => {
//           reject(err instanceof Error ? err : new Error('Proof session failed'))
//         },
//       })
//       .catch((err: unknown) => {
//         reject(err instanceof Error ? err : new Error('Failed to start proof session'))
//       })
//   })
// }

// async function verifyWithBackend(
//   endpoint: string,
//   proof: ProofPayload,
//   walletAddress: string
// ): Promise<VerifyResponse> {
//   const response = await fetch(endpoint, {
//     method: 'POST',
//     headers: { 'Content-Type': 'application/json' },
//     body: JSON.stringify({ proof, walletAddress }),
//   })

//   let body: VerifyResponse | { message?: string } = { message: 'Unknown error' }
//   try {
//     body = await response.json()
//   } catch {
//     body = { message: 'Invalid JSON response from backend' }
//   }

//   const parsed = body as VerifyResponse
//   if (!response.ok || !parsed.success) {
//     throw new Error(body.message || 'Verification failed')
//   }
//   if (!parsed.txId || typeof parsed.txId !== 'string') {
//     throw new Error('Backend did not return a valid transaction id')
//   }

//   return parsed
// }

// function App() {
//   const [account, setAccount] = useState<string | null>(null)
//   const [loading, setLoading] = useState(false)
//   const [result, setResult] = useState<VerifyResponse | null>(null)
//   const [error, setError] = useState<string | null>(null)
//   const [requestUrl, setRequestUrl] = useState('')

//   const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID as string | undefined
//   const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET as string | undefined
//   const PROVIDER_ID = import.meta.env.VITE_RECLAIM_PROVIDER_ID as string | undefined
//   const BACKEND_VERIFY_URL = import.meta.env.VITE_BACKEND_VERIFY_URL as string | undefined

//   useEffect(() => {
//     let mounted = true

//     const reconnect = async () => {
//       try {
//         const accounts = await peraWallet.reconnectSession()
//         if (!mounted || !accounts?.length) return
//         setAccount(accounts[0])
//       } catch {
//         if (mounted) setAccount(null)
//       }
//     }

//     reconnect()

//     return () => {
//       mounted = false
//     }
//   }, [])

//   const connectWallet = useCallback(async () => {
//     setError(null)
//     try {
//       const accounts = await peraWallet.connect()
//       if (!accounts?.length) {
//         throw new Error('No wallet account returned')
//       }
//       setAccount(accounts[0])
//     } catch (err) {
//       setError(err instanceof Error ? err.message : 'Wallet connection failed')
//     }
//   }, [])

//   const disconnectWallet = useCallback(async () => {
//     await peraWallet.disconnect()
//     setAccount(null)
//     setResult(null)
//     setRequestUrl('')
//     setError(null)
//   }, [])

//   const handleVerify = useCallback(async () => {
//     if (!account) {
//       setError('Connect your wallet before verification')
//       return
//     }
//     if (!APP_ID || !APP_SECRET || !PROVIDER_ID || !BACKEND_VERIFY_URL) {
//       setError('Missing required environment configuration')
//       return
//     }

//     setLoading(true)
//     setError(null)
//     setResult(null)

//     try {
//       const proof = await generateProof(APP_ID, APP_SECRET, PROVIDER_ID, account, setRequestUrl)
//       const verifyResult = await verifyWithBackend(BACKEND_VERIFY_URL, proof, account)
//       setResult(verifyResult)
//       setRequestUrl('')
//     } catch (err) {
//       setError(err instanceof Error ? err.message : 'Verification failed')
//     } finally {
//       setLoading(false)
//     }
//   }, [APP_ID, APP_SECRET, PROVIDER_ID, BACKEND_VERIFY_URL, account])

//   const txExplorerUrl = useMemo(() => {
//     if (!result?.txId) return ''
//     return `https://lora.algokit.io/testnet/transaction/${result.txId}`
//   }, [result?.txId])

//   return (
//     <div
//       style={{
//         maxWidth: 720,
//         margin: '40px auto',
//         padding: '0 20px 40px',
//         fontFamily: 'system-ui, -apple-system, Segoe UI, sans-serif',
//       }}
//     >
//       <h1 style={{ marginBottom: 8 }}>Acre Income Verifier</h1>
//       <p style={{ color: '#5f6368', marginBottom: 24 }}>
//         Connect wallet, generate proof, and verify income on-chain.
//       </p>

//       <div
//         style={{
//           border: '1px solid #e5e7eb',
//           borderRadius: 12,
//           padding: 16,
//           marginBottom: 16,
//           display: 'flex',
//           justifyContent: 'space-between',
//           alignItems: 'center',
//           gap: 12,
//           flexWrap: 'wrap',
//         }}
//       >
//         <div>
//           <div style={{ fontSize: 12, color: '#6b7280', marginBottom: 4 }}>Wallet</div>
//           <div style={{ fontWeight: 600 }}>
//             {account ? truncateAddress(account) : 'Not connected'}
//           </div>
//         </div>

//         {!account ? (
//           <button
//             onClick={connectWallet}
//             style={{
//               padding: '10px 16px',
//               borderRadius: 8,
//               border: '1px solid #111827',
//               background: '#111827',
//               color: '#fff',
//               cursor: 'pointer',
//               fontWeight: 600,
//             }}
//           >
//             Connect Pera Wallet
//           </button>
//         ) : (
//           <button
//             onClick={disconnectWallet}
//             style={{
//               padding: '10px 16px',
//               borderRadius: 8,
//               border: '1px solid #d1d5db',
//               background: '#fff',
//               color: '#111827',
//               cursor: 'pointer',
//               fontWeight: 600,
//             }}
//           >
//             Disconnect
//           </button>
//         )}
//       </div>

//       <button
//         onClick={handleVerify}
//         disabled={!account || loading}
//         style={{
//           width: '100%',
//           padding: '14px 18px',
//           borderRadius: 10,
//           border: 'none',
//           background: !account || loading ? '#9ca3af' : '#1d4ed8',
//           color: '#fff',
//           cursor: !account || loading ? 'not-allowed' : 'pointer',
//           fontWeight: 700,
//           fontSize: 15,
//         }}
//       >
//         {loading ? 'Verifying...' : 'Verify Income'}
//       </button>

//       {loading && (
//         <p style={{ marginTop: 12, color: '#374151' }}>
//           Waiting for proof + backend verification...
//         </p>
//       )}

//       {requestUrl && loading && (
//         <div
//           style={{
//             marginTop: 20,
//             padding: 20,
//             borderRadius: 12,
//             border: '1px solid #e5e7eb',
//             background: '#fff',
//             textAlign: 'center',
//           }}
//         >
//           <QRCodeSVG value={requestUrl} size={220} />
//           <p style={{ marginTop: 12, fontSize: 14, color: '#6b7280' }}>
//             Scan QR to complete proof flow
//           </p>
//         </div>
//       )}

//       {error && (
//         <div
//           style={{
//             marginTop: 16,
//             border: '1px solid #fecaca',
//             background: '#fef2f2',
//             color: '#991b1b',
//             borderRadius: 10,
//             padding: 12,
//           }}
//         >
//           {error}
//         </div>
//       )}

//       {result && (
//         <div
//           style={{
//             marginTop: 20,
//             border: '1px solid #bfdbfe',
//             background: '#eff6ff',
//             borderRadius: 12,
//             padding: 16,
//             textAlign: 'left',
//           }}
//         >
//           <h3 style={{ margin: '0 0 12px', color: '#1e40af' }}>Verification Complete</h3>

//           <div style={{ display: 'grid', gap: 8 }}>
//             <div>
//               <strong>Tier:</strong> {result.tier}
//             </div>
//             <div>
//               <strong>Credit Limit:</strong> {formatInr(result.creditLimit)}
//             </div>
//             <div>
//               <strong>Transaction ID:</strong> {result.txId}
//             </div>
//             {txExplorerUrl && (
//               <div>
//                 <a href={txExplorerUrl} target="_blank" rel="noreferrer">
//                   View on AlgoExplorer (TestNet)
//                 </a>
//               </div>
//             )}
//           </div>
//         </div>
//       )}
//     </div>
//   )
// }

// export default App
