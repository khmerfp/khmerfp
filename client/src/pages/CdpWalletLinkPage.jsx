// use cdp email onboarding while preserving separate khmerfp session ownership.
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { CDPReactProvider, AuthButton } from '@coinbase/cdp-react'
import { useCurrentUser, useIsInitialized, useSignOut, useSignEvmTypedData } from '@coinbase/cdp-hooks'
import { getCurrentUser } from '@coinbase/cdp-core'
import { id } from 'ethers'
import { assertWalletLinkChallenge } from '../../../packages/domain/src/walletLinkProtocol.js'
import { ArrowLeft, Wallet, Link2, RefreshCw, Loader2, AlertTriangle } from 'lucide-react'
import { useAuth } from '../auth/authContext.js'
import AuthModal from '../components/AuthModal.jsx'
import { embeddedEoa, embeddedWalletConfig, signEmbeddedOwnership, checkEmbeddedWalletProject, walletFailureMessage } from '../services/cdpEmbeddedWallet.js'
import { listLinkedWallets, requestWalletLink, verifyWalletLink } from '../services/walletLinkApi.js'
import './WalletLinkPage.css'
import './CdpWalletLinkPage.css'

export const WALLET_INITIALIZATION_TIMEOUT_MS = 20000
const reloadWalletPage = () => window.location.reload()

const theme = { 'colors-bg-default': '#111820', 'colors-bg-alternate': '#0a0e14',
  'colors-fg-default': '#ffffff', 'colors-fg-muted': '#94a3b8', 'colors-bg-primary': '#2bc5a6' }

export function EmbeddedWalletPanel({ onRetryInitialization = reloadWalletPage, onSignInRequired }) {
  const { user } = useAuth()
  const { currentUser } = useCurrentUser()
  const { isInitialized } = useIsInitialized()
  const { signOut } = useSignOut()
  const { signEvmTypedData } = useSignEvmTypedData()
  const [links, setLinks] = useState([])
  const [linksReady, setLinksReady] = useState(false)
  const [challenge, setChallenge] = useState(null)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [approved, setApproved] = useState(false)
  const [initializationExpired, setInitializationExpired] = useState(false)
  const [uncertain, setUncertain] = useState(false)
  const [sessionExpired, setSessionExpired] = useState(false)
  const generation = useRef(0)
  const operation = useRef(null)
  const readVersion = useRef(0)
  const mounted = useRef(false)
  const address = embeddedEoa(currentUser)
  const context = `${user?.id || ''}:${currentUser?.userId || ''}:${address || ''}`
  const activeContext = useRef(context)
  activeContext.current = context

  // this timer watches SDK startup only; it never runs against an open email-code flow.
  useEffect(() => {
    setInitializationExpired(false)
    if (isInitialized) return
    const timer = setTimeout(() => setInitializationExpired(true), WALLET_INITIALIZATION_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [isInitialized])

  async function readLinks(signal, current) {
    const version = ++readVersion.current
    const data = await listLinkedWallets({ signal, expectedUserId: String(user.id) })
    if (!current() || version !== readVersion.current) return false
    setLinks(data.wallets); setLinksReady(true); setUncertain(false); setSessionExpired(false)
    return true
  }

  useEffect(() => {
    mounted.current = true
    const version = ++generation.current
    const controller = new AbortController()
    const current = () => mounted.current && !controller.signal.aborted && version === generation.current && activeContext.current === context
    setChallenge(null); setApproved(false); setMessage(''); setError(''); setLinks([])
    setLinksReady(false); setUncertain(false); setSessionExpired(false)
    if (user) void readLinks(controller.signal, current).catch(failure => {
      if (current() && failure.name !== 'AbortError') {
        setError(walletFailureMessage(failure))
        if (failure?.status === 401) setSessionExpired(true)
      }
    })
    return () => {
      mounted.current = false; generation.current++; readVersion.current++
      controller.abort()
      if (operation.current) { operation.current.cancelled = true; operation.current.controller.abort() }
    }
  }, [context, user])

  async function run(work) {
    if (operation.current) return
    const attempt = { controller: new AbortController(), phase: 'request', cancelled: false }
    operation.current = attempt
    setBusy(true); setError(''); setMessage('')
    const version = generation.current, original = context
    const current = () => mounted.current && !attempt.cancelled && !attempt.controller.signal.aborted &&
      generation.current === version && activeContext.current === original
    try { await work(current, attempt) } catch (failure) {
      if (current()) {
        setChallenge(null); setApproved(false)
        setError(walletFailureMessage(failure))
        if (failure?.status === 401 && /session|authentication required|challenge does not belong/i.test(failure?.message || '')) {
          setSessionExpired(true); setLinks([]); setLinksReady(false)
        }
        if (attempt.phase === 'verify') { setUncertain(true); setLinksReady(false) }
      }
    } finally {
      if (operation.current === attempt) {
        operation.current = null
        if (mounted.current) setBusy(false)
      }
    }
  }
  function cancel() {
    const attempt = operation.current
    if (attempt) {
      attempt.cancelled = true
      attempt.controller.abort()
      if (attempt.phase === 'verify') { setUncertain(true); setLinksReady(false) }
    }
    generation.current++; setChallenge(null); setApproved(false); setError('')
    setMessage(attempt?.phase === 'sign'
      ? 'Cancelled locally. Close the wallet prompt; no new signing request can start until it finishes.'
      : 'Cancelled locally. An already submitted verification may have completed; refresh wallet records.')
  }
  async function prepare(action, current, attempt) {
    if (!user || !address || !currentUser?.userId || sessionExpired) throw new Error('Sign in to KhmerFP and your embedded wallet first.')
    if (!linksReady || uncertain) throw new Error('Refresh wallet records before requesting another proof.')
    if (challenge) return
    const next = await requestWalletLink({ walletAddress: address, chainId: 84532, action }, { signal: attempt.controller.signal })
    if (current()) {
      assertWalletLinkChallenge(next, { origin: location.origin, wallet: address, userId: String(user.id), action, domainSalt: id(location.origin) })
      setChallenge({ ...next, action }); setApproved(false)
    }
  }
  async function verify(current, attempt) {
    if (!approved || !challenge || sessionExpired || uncertain) throw new Error('Review and approve a fresh ownership message first.')
    const { action, ...payload } = challenge
    attempt.phase = 'sign'
    // signing has no application deadline; the user may be approving SDK authentication or MFA.
    const signature = await signEmbeddedOwnership({ challenge: payload, userId: String(user.id), address,
      cdpUserId: currentUser.userId, action, origin: location.origin, getUser: getCurrentUser,
      signTypedData: signEvmTypedData, isCurrent: current })
    if (!current()) return
    attempt.phase = 'verify'
    const result = await verifyWalletLink({ challengeId: payload.challengeId, signature }, { signal: attempt.controller.signal })
    if (!current()) return
    setChallenge(null); setApproved(false)
    attempt.phase = 'refresh'
    if (!await readLinks(attempt.controller.signal, current)) return
    setMessage(result.wallet.wallet_status === 'REVOKED' ? 'Wallet link revoked.' : 'Wallet ownership verified and saved. No trading or transfer permission granted.')
  }
  async function refresh(current, attempt) {
    if (await readLinks(attempt.controller.signal, current)) setMessage('Wallet records refreshed. Prepare a fresh proof if needed.')
  }
  const linked = links.find(w => w.wallet_address.toLowerCase() === address?.toLowerCase() && String(w.chain_id) === '84532')
  return <div className="embedded-wallet__sections">
    <section className="wallet-settings__card embedded-wallet__connect" aria-busy={busy}>
      <div className="embedded-wallet__card-header">
        <span className="embedded-wallet__icon"><Wallet size={23} aria-hidden="true" /></span>
        <h2>Create or access your wallet</h2>
        <span className={`embedded-wallet__status ${currentUser ? 'embedded-wallet__status--connected' : ''}`}>{currentUser ? 'Connected' : 'Not connected'}</span>
      </div>
      {!isInitialized && initializationExpired ? <div className="wallet-settings__connection" role="alert">
        <p>Coinbase wallet setup is taking too long. Check your connection and the CDP project configuration.</p>
        <button className="wallet-settings__secondary" onClick={onRetryInitialization}>Retry wallet setup</button>
      </div> : !isInitialized ? <div className="embedded-wallet__loading" role="status" aria-label="Loading embedded wallet">
        <Loader2 size={20} className="embedded-wallet__loading-spinner" aria-hidden="true" />
        <div className="embedded-wallet__loading-lines" aria-hidden="true"><span /><span /></div>
        <span className="embedded-wallet__sr-only">Loading embedded wallet...</span>
      </div> : !currentUser ? <div className="embedded-wallet__signin"><AuthButton /></div> : <>
        <p className="embedded-wallet__signed-in">CDP wallet signed in</p>
        <p className="wallet-settings__address">{address || 'No embedded EOA is available. Sign out and retry.'}</p>
        <p className="embedded-wallet__network">Base Sepolia (84532) <span aria-hidden="true">/</span> Embedded EOA</p>
        <button className="wallet-settings__secondary" disabled={busy} onClick={() => run(async (current, attempt) => {
          setChallenge(null); setApproved(false); attempt.phase = 'sign'
          await signOut()
          if (current()) setMessage('Signed out of the embedded wallet.')
        })}>Sign out of CDP / Switch wallet</button>
        {address && <div className="wallet-settings__actions">
          <button className="wallet-settings__primary" disabled={busy || !linksReady || uncertain || sessionExpired || Boolean(challenge) || linked?.wallet_status === 'ACTIVE'}
            onClick={() => run((current, attempt) => prepare(linked?.wallet_status === 'REVOKED' ? 'RELINK' : 'LINK', current, attempt))}>Prepare ownership verification</button>
          {linked?.wallet_status === 'ACTIVE' && <button className="wallet-settings__secondary" disabled={busy || !linksReady || uncertain || sessionExpired || Boolean(challenge)}
            onClick={() => run((current, attempt) => prepare('UNLINK', current, attempt))}>Prepare unlink proof</button>}
        </div>}
      </>}
      {challenge && <div className="wallet-settings__connection">
        <h3>Review ownership message</h3>
        <p>This signs an account-linking message, not a transaction. Unlink/relink also needs fresh KhmerFP step-up authentication.</p>
        <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(challenge.typedData, null, 2)}</pre>
        <label><input type="checkbox" checked={approved} onChange={e => setApproved(e.target.checked)} /> I approve this ownership signature.</label>
        <button className="wallet-settings__primary" disabled={busy || !approved} onClick={() => run(verify)}>Sign and verify ownership</button>
      </div>}
      {(busy || challenge) && <button className="wallet-settings__secondary" onClick={cancel}>Cancel pending action</button>}
      {error && <div className="wallet-settings__connection" role="alert"><p>{error}</p>
        <button className="wallet-settings__secondary" disabled={busy} onClick={() => run(refresh)}>Retry status check</button>
      </div>}
      {uncertain && <p role="status">Verification outcome is uncertain. Refresh wallet records before preparing another proof.</p>}
      {sessionExpired && onSignInRequired && <button className="wallet-settings__secondary" onClick={onSignInRequired}>Sign in to KhmerFP again</button>}
      {message && <p role="status">{message}</p>}
      {busy && <p role="status">Waiting for wallet or backend...</p>}
    </section>
    <section className="wallet-settings__card embedded-wallet__linked">
      <div className="embedded-wallet__card-header">
        <span className="embedded-wallet__icon embedded-wallet__icon--neutral"><Link2 size={21} aria-hidden="true" /></span>
        <h2>Your linked wallets</h2>
      <button className="wallet-settings__secondary embedded-wallet__refresh" disabled={busy} onClick={() => run(refresh)}><RefreshCw size={14} aria-hidden="true" />Refresh wallets</button>
      </div>
      {links.length ? links.map(w => <div className="wallet-settings__connection" key={w.id}>
        <p className="wallet-settings__address">{w.wallet_address}</p>
        <p>{w.wallet_type} / {w.ownership_verification_status} / {w.wallet_status}</p>
      </div>) : <div className="embedded-wallet__empty">
        <span className="embedded-wallet__empty-icon"><Wallet size={26} aria-hidden="true" /></span>
        <p>No verified wallets linked yet.</p>
      </div>}
    </section>
  </div>
}

export function WalletProjectGate({ config, children }) {
  const [attempt, setAttempt] = useState(0)
  const [state, setState] = useState({ loading: true, ready: false, error: '' })
  const running = useRef(false)
  useEffect(() => {
    const controller = new AbortController()
    let active = true
    running.current = true
    setState({ loading: true, ready: false, error: '' })
    void checkEmbeddedWalletProject(config.projectId, { signal: controller.signal }).then(() => {
      if (active) setState({ loading: false, ready: true, error: '' })
    }).catch(failure => {
      if (active && failure.name !== 'AbortError') setState({ loading: false, ready: false, error: failure.message })
    }).finally(() => { if (active) running.current = false })
    return () => { active = false; controller.abort() }
  }, [config.projectId, attempt])
  if (state.ready) return children
  return <section className="wallet-settings__card" aria-busy={state.loading}>
    <h2>Create or access your wallet</h2>
    {state.loading ? <div className="embedded-wallet__loading" role="status" aria-label="Checking wallet configuration">
      <Loader2 className="embedded-wallet__loading-spinner" size={20} aria-hidden="true" />
      <span>Checking wallet configuration...</span>
    </div> : <div className="embedded-wallet__warning" role="alert">
      <AlertTriangle className="embedded-wallet__warning-icon" size={21} aria-hidden="true" />
      <div className="embedded-wallet__warning-content">
        <h3>Wallet setup is temporarily unavailable</h3>
        <p>Please try again. If this continues, contact the KhmerFP team.</p>
        <details className="embedded-wallet__warning-details"><summary>Technical details</summary><p>{state.error}</p></details>
      </div>
      <button className="embedded-wallet__warning-retry" onClick={() => {
        if (running.current) return
        running.current = true
        setAttempt(value => value + 1)
      }}><RefreshCw size={15} aria-hidden="true" />Try again</button>
    </div>}
  </section>
}

class WalletBoundary extends React.Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    if (this.state.failed) return <section className="wallet-settings__card" role="alert">
      <p>Embedded wallet initialization failed. Check the project, allowed origin and network connection.</p>
      <button className="wallet-settings__secondary" onClick={() => this.setState({ failed: false })}>Retry wallet setup</button>
    </section>
    return this.props.children
  }
}

export default function CdpWalletLinkPage() {
  const { user, status } = useAuth()
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const { config, error } = useMemo(() => {
    try { return { config: embeddedWalletConfig() } } catch (failure) { return { error: failure.message } }
  }, [import.meta.env.DEV, import.meta.env.VITE_CDP_EMBEDDED_WALLET_ENABLED, import.meta.env.VITE_CDP_PROJECT_ID])
  return <main className="wallet-settings embedded-wallet"><div className="wallet-settings__shell">
    <a className="wallet-settings__back" href="/"><ArrowLeft size={15} aria-hidden="true" />Back to KhmerFP</a>
    <header className="wallet-settings__header"><div><p className="wallet-settings__eyebrow">ACCOUNT SETTINGS / WALLETS</p>
      <h1>Your KhmerFP wallet</h1></div>
      <span className="wallet-settings__badge">Base Sepolia / Testnet</span></header>
    {status === 'loading' ? <p>Checking KhmerFP session...</p> : !user ? <section className="wallet-settings__card">
      <p>Sign in to KhmerFP first. Existing email, Google and Telegram login stay unchanged.</p>
      <button className="wallet-settings__primary" onClick={() => setShowAuth(true)}>Sign in to KhmerFP</button>
    </section> : error ? <section className="wallet-settings__card" role="alert"><p>{error}</p>
      <button className="wallet-settings__secondary" onClick={reloadWalletPage}>Retry wallet setup</button>
    </section> : <WalletProjectGate key={`${user.id}:${config.projectId}`} config={config}>
      <WalletBoundary><CDPReactProvider config={config} theme={theme}>
        <EmbeddedWalletPanel onSignInRequired={() => setShowAuth(true)} />
      </CDPReactProvider></WalletBoundary>
    </WalletProjectGate>}
    {showAuth && <AuthModal mode={authMode} onModeChange={setAuthMode} onClose={() => setShowAuth(false)} />}
  </div></main>
}
