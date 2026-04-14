import { useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'

type DriverData = {
  tripsCompleted: number
  driverRating: number
  accountAgeMonths: number
  weeklyEarnings: number
  monthlyEarnings: number
}

type VerificationResult = {
  tier: number
  creditLimit: number
  driverData: DriverData
  creditReason: string
  uberIdentity: {
    uid: string
    verified: boolean
  }
  provider: string
  message: string
  demoNote: string
}

function App() {
  const [status, setStatus] = useState('idle')
  const [requestUrl, setRequestUrl] = useState('')
  const [result, setResult] = useState<VerificationResult | null>(null)
  const [error, setError] = useState('')

  const APP_ID = import.meta.env.VITE_RECLAIM_APP_ID
  const APP_SECRET = import.meta.env.VITE_RECLAIM_APP_SECRET
  const PROVIDER_ID =
    import.meta.env.VITE_RECLAIM_PROVIDER_ID || 'uber-uid' // Use uid provider for identity
  const BACKEND_VERIFY_URL =
    import.meta.env.VITE_BACKEND_VERIFY_URL ||
    'http://localhost:3001/verify-proof'

  const statusMessage = useMemo(() => {
    switch (status) {
      case 'generating':
        return 'Generating QR...'
      case 'waiting':
        return 'Scan with phone & login to Uber...'
      case 'verifying_backend':
        return 'Verifying identity & generating driver profile...'
      case 'verified':
        return '✅ Driver profile created!'
      case 'error':
        return '❌ Verification failed'
      default:
        return 'Ready to verify'
    }
  }, [status])

  const handleVerifyIncome = async () => {
    setError('')
    setResult(null)
    setRequestUrl('')

    if (!APP_ID || !APP_SECRET) {
      setStatus('error')
      setError('Missing Reclaim credentials. Check .env file.')
      return
    }

    try {
      setStatus('generating')

      const { ReclaimProofRequest } = await import('@reclaimprotocol/js-sdk')

      const reclaim = await ReclaimProofRequest.init(
        APP_ID,
        APP_SECRET,
        PROVIDER_ID
      )

      const verificationUrl = await reclaim.getRequestUrl()
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
              throw new Error(body?.message || 'Backend verification failed')
            }

            setResult({
              tier: body.tier,
              creditLimit: body.creditLimit,
              driverData: body.driverData,
              creditReason: body.creditReason,
              uberIdentity: body.uberIdentity,
              provider: body.provider,
              message: body.message,
              demoNote: body.demoNote,
            })

            setStatus('verified')
            setRequestUrl('')
          } catch (err) {
            setStatus('error')
            setError(err instanceof Error ? err.message : 'Verification failed')
          }
        },
        onError: (err) => {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Session failed')
        },
      })
    } catch (err) {
      setStatus('error')
      setError(err instanceof Error ? err.message : 'Failed to start')
    }
  }

  return (
    <div style={{ 
      maxWidth: 600, 
      margin: '40px auto', 
      textAlign: 'center',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '0 20px'
    }}>
      <h1 style={{ marginBottom: '8px' }}>🚗 Acre Protocol</h1>
      <p style={{ color: '#666', marginBottom: '24px' }}>
        Privacy-preserving income verification for gig workers
      </p>

      <button
        onClick={handleVerifyIncome}
        disabled={status !== 'idle' && status !== 'error'}
        style={{
          padding: '14px 28px',
          fontSize: '16px',
          background: status === 'error' ? '#c62828' : '#276EF1',
          color: 'white',
          border: 'none',
          borderRadius: '8px',
          cursor: 'pointer',
          fontWeight: 600,
        }}
      >
        {status === 'idle' || status === 'error' 
          ? 'Connect as Uber Driver' 
          : 'Processing...'}
      </button>

      <p style={{ marginTop: '16px', color: '#666', minHeight: '24px' }}>
        {statusMessage}
      </p>

      {/* QR Code */}
      {status === 'waiting' && requestUrl && (
        <div style={{ marginTop: '24px' }}>
          <div style={{
            display: 'inline-block',
            padding: '24px',
            background: 'white',
            borderRadius: '16px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.1)'
          }}>
            <QRCodeSVG value={requestUrl} size={240} />
          </div>
          <p style={{ fontSize: '14px', color: '#666', marginTop: '12px' }}>
            Scan with your phone camera to login to Uber
          </p>
        </div>
      )}

      {/* Success Result */}
      {status === 'verified' && result && (
        <div style={{
          marginTop: '24px',
          padding: '24px',
          background: '#f0f9ff',
          borderRadius: '16px',
          textAlign: 'left',
          border: '1px solid #bae6fd'
        }}>
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            marginBottom: '16px'
          }}>
            <span style={{ fontSize: '32px' }}>✅</span>
            <div>
              <h3 style={{ margin: 0, color: '#0369a1' }}>Driver Verified</h3>
              <p style={{ margin: '4px 0 0', fontSize: '14px', color: '#666' }}>
                Uber identity: {result.uberIdentity.uid}
              </p>
            </div>
          </div>

          {/* Driver Stats */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: '12px',
            marginBottom: '16px',
            padding: '16px',
            background: 'white',
            borderRadius: '12px'
          }}>
            <div>
              <div style={{ fontSize: '12px', color: '#666' }}>Trips Completed</div>
              <div style={{ fontSize: '20px', fontWeight: 600 }}>
                {result.driverData.tripsCompleted.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666' }}>Driver Rating</div>
              <div style={{ fontSize: '20px', fontWeight: 600 }}>
                ⭐ {result.driverData.driverRating}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666' }}>Weekly Earnings</div>
              <div style={{ fontSize: '20px', fontWeight: 600 }}>
                ₹{result.driverData.weeklyEarnings.toLocaleString()}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '12px', color: '#666' }}>Account Age</div>
              <div style={{ fontSize: '20px', fontWeight: 600 }}>
                {result.driverData.accountAgeMonths} months
              </div>
            </div>
          </div>

          {/* Credit Tier */}
          <div style={{
            padding: '20px',
            background: '#276EF1',
            color: 'white',
            borderRadius: '12px',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '14px', opacity: 0.9, marginBottom: '4px' }}>
              {result.creditReason} • Tier {result.tier}
            </div>
            <div style={{ fontSize: '32px', fontWeight: 700 }}>
              ₹{result.creditLimit.toLocaleString()}
            </div>
            <div style={{ fontSize: '14px', opacity: 0.9, marginTop: '4px' }}>
              Pre-approved loan limit
            </div>
          </div>

          {/* Demo Note */}
          <p style={{
            marginTop: '16px',
            fontSize: '12px',
            color: '#666',
            textAlign: 'center',
            fontStyle: 'italic'
          }}>
            {result.demoNote}
          </p>
        </div>
      )}

      {/* Error */}
      {status === 'error' && (
        <p style={{ color: '#c62828', marginTop: '16px' }}>{error}</p>
      )}
    </div>
  )
}

export default App