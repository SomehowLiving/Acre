import { useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'

function App() {
  const [status, setStatus] = useState('idle')
  const [requestUrl, setRequestUrl] = useState('')
  const [result, setResult] = useState(null)
  const [error, setError] = useState('')

  // ✅ Vite env variables
  const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID
  const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET
  const PROVIDER_ID =
    import.meta.env.VITE_RECLAIM_PROVIDER_ID || 'uber-driver-earnings'
  const BACKEND_VERIFY_URL =
    import.meta.env.VITE_BACKEND_VERIFY_URL ||
    'http://localhost:3001/verify-proof'

  const statusMessage = useMemo(() => {
    switch (status) {
      case 'generating':
        return 'Generating QR...'
      case 'waiting':
        return 'Waiting for verification...'
      case 'verifying_backend':
        return 'Validating proof...'
      case 'verified':
        return 'Verified!'
      case 'error':
        return 'Verification failed'
      default:
        return 'Idle'
    }
  }, [status])

  const handleVerifyIncome = async () => {
    setError('')
    setResult(null)
    setRequestUrl('')

    if (!APP_ID || !APP_SECRET) {
      setStatus('error')
      setError('Missing env variables')
      return
    }

    try {
      setStatus('generating')

      // ✅ Lazy import to avoid crashes
      const { ReclaimProofRequest } = await import(
        '@reclaimprotocol/js-sdk'
      )

      const reclaim = await ReclaimProofRequest.init(
        APP_ID,
        APP_SECRET,
        PROVIDER_ID
      )

      const { requestUrl: verificationUrl } =
        await reclaim.createVerificationRequest()

      setRequestUrl(verificationUrl)
      setStatus('waiting')

      await reclaim.startSession({
        onSuccess: async (proofPayload) => {
          try {
            setStatus('verifying_backend')

            const proof = Array.isArray(proofPayload)
              ? proofPayload[0]
              : proofPayload

            const response = await fetch(BACKEND_VERIFY_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ proof }),
            })

            const body = await response.json()

            if (!response.ok || !body?.success) {
              throw new Error(body?.message || 'Backend failed')
            }

            setResult({
              income_band: body.tier,
              provider: body.provider || 'uber',
            })

            setStatus('verified')
            setRequestUrl('')
          } catch (err) {
            setStatus('error')
            setError(err.message)
          }
        },
        onError: (err) => {
          setStatus('error')
          setError(err?.message || 'Session failed')
        },
      })
    } catch (err) {
      setStatus('error')
      setError(err?.message || 'Failed to start')
    }
  }

  return (
    <div style={{ maxWidth: 500, margin: '40px auto', textAlign: 'center' }}>
      <h2>Acre Income Verification</h2>

      <button onClick={handleVerifyIncome}>
        Connect Uber Income
      </button>

      <p>Status: {statusMessage}</p>

      {status === 'waiting' && requestUrl && (
        <div>
          <p>Scan QR with your phone</p>
          <QRCodeSVG value={requestUrl} size={220} />
        </div>
      )}

      {status === 'verified' && result && (
        <div>
          <h3>Verified ✅</h3>
          <p>Provider: {result.provider}</p>
          <p>Tier: {result.income_band}</p>
        </div>
      )}

      {status === 'error' && (
        <p style={{ color: 'red' }}>{error}</p>
      )}
    </div>
  )
}

export default App