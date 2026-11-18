// show wallet connection and ownership steps for the signed-in user.
import React, { useEffect, useRef, useState } from 'react'
import { id } from 'ethers'
import { ArrowLeft, ArrowRight, Wallet, ShieldCheck, Fingerprint, Link2, Unplug, AlertCircle, Check, Loader2, LockKeyhole } from 'lucide-react'
import './WalletLinkPage.css'
import { inspectCoinbaseWalletSetup } from '../services/coinbaseWalletSetup.js'
import { useAuth } from '../auth/authContext.js'
import AuthModal from '../components/AuthModal.jsx'
import { connectUserCoinbaseWallet, signWalletOwnership } from '../services/coinbaseWallet.js'
import {
  listLinkedWallets,
  requestWalletLink,
  verifyWalletLink,
} from '../services/walletLinkApi.js'
import {
  assertWalletLinkChallenge,
  WALLET_LINK_CHAIN,
} from '../../../packages/domain/src/walletLinkProtocol.js'

export default function WalletLinkPage() {
  const { user, status } = useAuth()
  const [wallet, setWallet] = useState(null)
  const [links, setLinks] = useState([])
  const [message, setMessage] = useState('')
  const [flow, setFlow] = useState('NOT_CONNECTED')
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState('')
  const [loadingLinks, setLoadingLinks] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const connection = useRef(null)
  const epoch = useRef(0)
  const locked = useRef(false)
  const setupCheck = useRef(null)

  // Disconnect the current wallet connection and reset state
  async function disconnect() {
    setupCheck.current?.abort()
    epoch.current++
    const previous = connection.current
    connection.current = null
    setWallet(null)
    setFlow('NOT_CONNECTED')
    await previous?.provider.disconnect?.()
  }

  // Load the list of linked wallets for the current user
  useEffect(() => {
    setupCheck.current?.abort()
    epoch.current++
    setWallet(null)
    setFlow('NOT_CONNECTED')
    setLinks([])
    setMessage('')
    setLoadingLinks(Boolean(user))
    const previous = connection.current
    connection.current = null
    void previous?.provider.disconnect?.()
    let active = true
    if (user) {
      void listLinkedWallets({ expectedUserId: String(user.id) })
        .then((data) => {
          if (active) {
            setLinks(data.wallets)
          }
        })
        .catch((error) => {
          if (active) {
            setMessage(error.message)
          }
        })
        .finally(() => {
          if (active) setLoadingLinks(false)
        })
    }

    // Cleanup function to disconnect the wallet and reset state when the component unmounts or user changes
    return () => {
      active = false
      setupCheck.current?.abort()
      epoch.current++
      const current = connection.current
      connection.current = null
      void current?.provider.disconnect?.()
    }
  }, [user?.id])
  useEffect(() => {
    if (!wallet) {
      return
    }
    const changed = () => {
      void disconnect()
      setMessage('Wallet changed. Connect again and request fresh proof.')
    }
    for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
      wallet.provider.on?.(event, changed)
    }
    return () => {
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
        wallet.provider.removeListener?.(event, changed)
      }
    }
  }, [wallet])
  async function run(work) {
    if (locked.current) {
      return
    }
    locked.current = true
    setBusy(true)
    setMessage('')
    try {
      await work()
    } catch (error) {
      if (error.status === 401 && /session|authentication required|challenge does not belong/i.test(error.message)) {
        await disconnect()
        setLinks([])
        setFlow('SESSION_EXPIRED')
        setMessage('Your KhmerFP session expired. Sign in again before continuing.')
      } else {
        setFlow(error.code === 4001 || error.code === 'ACTION_REJECTED'
          ? (wallet ? 'SIGNATURE_REJECTED' : 'CONNECTION_REJECTED') : /network|Base Sepolia/i.test(error.message) ? 'WRONG_NETWORK' : (wallet ? 'VERIFICATION_FAILED' : 'CONNECTION_FAILED'))
        setMessage(
          error.code === 4001 || error.code === 'ACTION_REJECTED'
            ? 'Wallet request cancelled. Nothing was linked or unlinked. You can try again.'
            : error.shortMessage || error.message,
        )
      }
    } finally {
      locked.current = false
      setBusy(false)
      setProgress('')
    }
  }
  // both buttons open coinbase's own onboarding; no coinbase credentials enter khmerfp.
  async function connectCoinbase() {
    await disconnect()
    const version = epoch.current
    const controller = new AbortController()
    setupCheck.current = controller
    setFlow('CONNECTING')
    setProgress('Continue in Coinbase to sign in or create a wallet. No ownership signature is requested yet.')
    try {
      const next = await connectUserCoinbaseWallet({ signal: controller.signal })
      if (version !== epoch.current || controller.signal.aborted) {
        await next.provider.disconnect?.()
        return
      }
      connection.current = next
      setWallet(next)
      setFlow(next.deployed ? 'CONNECTED_NOT_VERIFIED' : 'SETUP_UNAVAILABLE')
    } catch (error) {
      if (version !== epoch.current || controller.signal.aborted) return
      throw error
    } finally {
      if (setupCheck.current === controller) setupCheck.current = null
    }
  }
  // request a fresh challenge before each link, unlink or relink proof.
  async function prove(action) {
    if (!user || !wallet || !wallet.deployed) {
      throw new Error('Sign in and connect a deployed smart wallet first.')
    }
    const version = epoch.current,
      principal = String(user.id)
    setFlow('REQUESTING_CHALLENGE')
    setProgress('Requesting a fresh ownership challenge...')
    const challenge = await requestWalletLink({
      walletAddress: wallet.address,
      chainId: WALLET_LINK_CHAIN,
      action,
    })
    if (version !== epoch.current) {
      throw new Error('Application account or wallet changed.')
    }
    const typedData = assertWalletLinkChallenge(challenge, {
      origin: location.origin,
      wallet: wallet.address,
      userId: principal,
      action,
      domainSalt: id(location.origin),
    })
    setFlow('WAITING_FOR_SIGNATURE')
    setProgress('Waiting for your wallet signature...')
    const signature = await signWalletOwnership(wallet, typedData)
    if (version !== epoch.current) {
      throw new Error('Account changed during signing. Proof discarded.')
    }
    setFlow('VERIFYING_OWNERSHIP')
    setProgress('Verifying wallet ownership...')
    await verifyWalletLink({ challengeId: challenge.challengeId, signature })
    if (version !== epoch.current) return
    const data = await listLinkedWallets({ expectedUserId: String(user.id) })
    if (version !== epoch.current) {
      return
    }
    setLinks(data.wallets)
    setFlow(action === 'UNLINK' ? 'CONNECTED_NOT_VERIFIED' : 'LINKED')
    setMessage(
      action === 'UNLINK'
        ? 'Wallet link revoked. On-chain approvals and signed orders are unchanged.'
        : 'Wallet ownership linked. No trading or transfer permission was granted.',
    )
  }
  const flowLabels = {
    NOT_CONNECTED: 'Not connected', CONNECTING: 'Connecting',
    CONNECTION_FAILED: 'Connection failed', CONNECTION_REJECTED: 'Connection rejected', SIGNATURE_REJECTED: 'Signature rejected',
    CONNECTED_NOT_VERIFIED: 'Connected - ownership proof required', WRONG_NETWORK: 'Wrong network',
    SETUP_UNAVAILABLE: 'Setup unavailable', REQUESTING_CHALLENGE: 'Preparing ownership request',
    WAITING_FOR_SIGNATURE: 'Waiting for signature', VERIFYING_OWNERSHIP: 'Verifying ownership',
    LINKED: 'Successfully linked', VERIFICATION_FAILED: 'Verification failed', SESSION_EXPIRED: 'Session expired',
  }
  const verifiedWallet = wallet && links.some(link =>
    link.wallet_address.toLowerCase() === wallet.address.toLowerCase() &&
    String(link.chain_id) === String(WALLET_LINK_CHAIN) &&
    link.wallet_status === 'ACTIVE' && link.ownership_verification_status === 'VERIFIED',
  )
  return (
    <main className="wallet-settings" aria-busy={busy}>
      <div className="wallet-settings__shell">
        <a href="/" className="wallet-settings__back"><ArrowLeft size={16} aria-hidden="true" />Back to KhmerFP</a>
        <header className="wallet-settings__header">
          <div>
            <p className="wallet-settings__eyebrow">ACCOUNT SETTINGS / WALLETS</p>
            <h1>Your wallet. Your control.</h1>
            <p>Link your Coinbase Smart Wallet to your KhmerFP account.</p>
          </div>
          <span className="wallet-settings__badge"><span />Base Sepolia / Testnet</span>
        </header>

        <div className="wallet-settings__flow" aria-live="polite"><span className="wallet-settings__dot" />{flowLabels[flow]}</div>
        {message && <div role="status" className="wallet-settings__notice"><AlertCircle size={18} aria-hidden="true" /><p>{message}</p></div>}
        {progress && <div role="status" aria-live="polite" className="wallet-settings__notice"><Loader2 size={18} className="wallet-settings__spinner" aria-hidden="true" /><p>{progress}</p></div>}

        {busy && flow !== 'VERIFYING_OWNERSHIP' && <button className="wallet-settings__secondary wallet-settings__cancel" onClick={() => {
          void disconnect()
          setMessage('Request cancelled locally. Dismiss any open wallet prompt.')
          setProgress('')
        }}>Cancel request</button>}
        {flow === 'SESSION_EXPIRED' && <button className="wallet-settings__primary wallet-settings__cancel" onClick={() => setShowAuth(true)}>Sign in again</button>}
        {message && !busy && <button className="wallet-settings__secondary wallet-settings__cancel" onClick={() => {
          setMessage('')
          setFlow(wallet ? (wallet.deployed ? 'CONNECTED_NOT_VERIFIED' : 'SETUP_UNAVAILABLE') : 'NOT_CONNECTED')
        }}>Dismiss and retry</button>}
        <div className="wallet-settings__layout">
          <div className="wallet-settings__content">
            <section className="wallet-settings__card" aria-labelledby="wallet-connect-title">
              <div className="wallet-settings__card-heading">
                <span className="wallet-settings__icon"><Wallet size={23} aria-hidden="true" /></span>
                <div><h2 id="wallet-connect-title">Connect your wallet</h2></div>
              </div>
              {status === 'loading' ? (
                <p className="wallet-settings__muted">Checking your KhmerFP session...</p>
              ) : !user ? (
                <div className="wallet-settings__signin">
                  <p>Sign in to your KhmerFP account before connecting a wallet.</p>
                  <button className="wallet-settings__primary" onClick={() => setShowAuth(true)}>Sign in to KhmerFP first<ArrowRight size={16} aria-hidden="true" /></button>
                </div>
              ) : (
                <>
                  <div className="wallet-settings__account"><span>Signed in as</span><strong>KhmerFP account: {user.display_name || user.email}</strong></div>
                  {!wallet && <p className="wallet-settings__intro">Have a Coinbase wallet? Sign in through Coinbase. New to Coinbase? Use the account creation option in its hosted window when available. Never enter Coinbase credentials on KhmerFP.</p>}
                  <button disabled={busy} className="wallet-settings__primary wallet-settings__connect" onClick={() => run(connectCoinbase)}>
                    <span className="wallet-settings__coinbase" aria-hidden="true">C</span>
                    Connect Coinbase wallet on Base Sepolia
                    <ArrowRight size={17} aria-hidden="true" />
                  </button>
                  {!wallet && <button disabled={busy} className="wallet-settings__secondary" onClick={() => run(connectCoinbase)}>New to Coinbase? Continue with Coinbase</button>}
                  {wallet && <p className="wallet-settings__muted">To choose another wallet, disconnect here, then reconnect and select the account in Coinbase. Linking does not change your KhmerFP login.</p>}

                  {wallet && <div className="wallet-settings__connection">
                    <div className="wallet-settings__connection-heading"><span><span className="wallet-settings__dot" />Wallet connected</span><button className="wallet-settings__text-button" disabled={busy} onClick={() => run(disconnect)}><Unplug size={14} aria-hidden="true" />Disconnect wallet</button></div>
                    <p className="wallet-settings__address">{wallet.address}</p>
                    <p className="wallet-settings__network">Network: Base Sepolia (84532)</p>
                    <dl className="wallet-settings__metadata"><div><dt>Wallet type</dt><dd>Coinbase Smart Wallet</dd></div><div><dt>Ownership</dt><dd>{verifiedWallet ? 'Verified link' : 'Not verified'}</dd></div></dl>
                    <div className={`wallet-settings__deployment ${wallet.deployed ? '' : 'wallet-settings__deployment--pending'}`}>
                      {wallet.deployed ? <ShieldCheck size={19} aria-hidden="true" /> : <AlertCircle size={19} aria-hidden="true" />}
                      <div><strong>{wallet.deployed ? 'Contract code detected' : 'Setup unavailable'}</strong><p>{wallet.setup?.message || (wallet.deployed ? 'Contract code detected; ownership proof still required.' : 'Wallet is undeployed. A supported setup operation and fee quote are not verified; no deployment or funds will be requested.')}</p></div>
                    </div>
                    <button className="wallet-settings__secondary" disabled={busy} onClick={() => run(async () => {
                      const version = epoch.current
                      const checked = wallet
                      // block signing until this fresh read succeeds, including thrown network errors.
                      setWallet({ ...checked, deployed: false })
                      const controller = new AbortController()
                      setupCheck.current?.abort()
                      setupCheck.current = controller
                      setProgress('Checking setup on Base Sepolia without signing...')
                      const setup = await inspectCoinbaseWalletSetup(checked, { signal: controller.signal })
                      if (version !== epoch.current || connection.current !== checked) return
                      const next = { ...checked, deployed: setup.deployed, setup }
                      connection.current = next
                      setWallet(next)
                      setFlow(setup.deployed ? 'CONNECTED_NOT_VERIFIED' : 'SETUP_UNAVAILABLE')
                    })}>Check setup again</button>
                    <div className="wallet-settings__actions">
                      {['LINK', 'UNLINK', 'RELINK'].map(action => <button key={action} className={action === 'LINK' ? 'wallet-settings__primary' : 'wallet-settings__secondary'} disabled={busy || !wallet.deployed} onClick={() => run(() => prove(action))}>
                        {action === 'LINK' && <Fingerprint size={16} aria-hidden="true" />}
                        {action === 'LINK' ? 'Sign ownership link' : action === 'UNLINK' ? 'Sign unlink proof' : 'Sign relink proof'}
                      </button>)}
                    </div>
                    <p className="wallet-settings__footnote">Unlink and relink also require application step-up authentication completed within five minutes. Connecting a wallet does not replace that check.</p>
                  </div>}
                </>
              )}
            </section>

            {user && <section className="wallet-settings__card" aria-labelledby="wallet-identities-title">
              <div className="wallet-settings__list-heading"><div><h2 id="wallet-identities-title">Your wallet identities</h2></div><span className="wallet-settings__count">{links.length}</span></div>
              {loadingLinks ? <p role="status" className="wallet-settings__muted">Loading linked wallets...</p> : links.length === 0 ? (
                <div className="wallet-settings__empty"><span className="wallet-settings__empty-icon"><Link2 size={25} aria-hidden="true" /></span><h3>No linked wallets yet</h3><p>No verified wallet identities found for this account.</p><p>Your wallets will appear here after ownership verification.</p></div>
              ) : <ul className="wallet-settings__list">{links.map(link => <li key={link.id}>
                <span className="wallet-settings__icon"><Wallet size={20} aria-hidden="true" /></span>
                <div><p className="wallet-settings__address">{link.wallet_address}</p><p>Chain {link.chain_id} / {link.wallet_status}</p><p>Ownership: {link.ownership_verification_status || 'Not verified'}</p>{wallet?.address.toLowerCase() === link.wallet_address.toLowerCase() && String(link.chain_id) === String(WALLET_LINK_CHAIN) && <p>Currently connected wallet</p>}<p>Ownership record only; no trading or transfer permission.</p></div>
              </li>)}</ul>}
            </section>}
          </div>

          <aside className="wallet-settings__sidebar">
            <section className="wallet-settings__card">
              <div className="wallet-settings__guide-heading"><ShieldCheck size={20} aria-hidden="true" /><h2>How linking works</h2></div>
              <ol className="wallet-settings__steps">
                <li><span>{wallet ? <Check size={15} aria-hidden="true" /> : '1'}</span><div><h3>Connect your wallet</h3><p>Sign in or create a wallet in Coinbase, then check its Base Sepolia setup.</p></div></li>
                <li><span>2</span><div><h3>Confirm ownership</h3><p>Review and sign a fresh ownership request.</p></div></li>
                <li><span>3</span><div><h3>Keep control</h3><p>Manage the link from your account settings.</p></div></li>
              </ol>
              <div className="wallet-settings__security"><LockKeyhole size={17} aria-hidden="true" /><p>Linking does not grant token approvals, order-signing access or permission to move funds.</p></div>
            </section>
            <div className="wallet-settings__test-note"><span className="wallet-settings__badge">TEST ENVIRONMENT</span><p>Base Sepolia test accounts only. No real funds are needed to view this page.</p></div>
          </aside>
        </div>
        <p className="wallet-settings__bottom-note"><LockKeyhole size={14} aria-hidden="true" />Never share your private key or recovery phrase.</p>
      </div>
      {showAuth && <AuthModal mode={authMode} onModeChange={setAuthMode} onClose={() => setShowAuth(false)} />}
    </main>
  )
}
