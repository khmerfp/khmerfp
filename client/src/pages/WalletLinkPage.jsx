import React, { useEffect, useRef, useState } from 'react'
import { id } from 'ethers'
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
  const [busy, setBusy] = useState(false)
  const [showAuth, setShowAuth] = useState(false)
  const [authMode, setAuthMode] = useState('login')
  const connection = useRef(null)
  const epoch = useRef(0)
  const locked = useRef(false)

  async function disconnect() {
    epoch.current++
    const previous = connection.current
    connection.current = null
    setWallet(null)
    await previous?.provider.disconnect?.()
  }
  useEffect(() => {
    epoch.current++
    setWallet(null)
    setLinks([])
    const previous = connection.current
    connection.current = null
    void previous?.provider.disconnect?.()
    let active = true
    if (user) {
      void listLinkedWallets()
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
    }
    return () => {
      active = false
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
      setMessage(error.shortMessage || error.message)
    } finally {
      locked.current = false
      setBusy(false)
    }
  }
  async function prove(action) {
    if (!user || !wallet || !wallet.deployed) {
      throw new Error('Sign in and connect a deployed smart wallet first.')
    }
    const version = epoch.current,
      principal = String(user.id)
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
    const signature = await signWalletOwnership(wallet, typedData)
    if (version !== epoch.current) {
      throw new Error('Account changed during signing. Proof discarded.')
    }
    await verifyWalletLink({ challengeId: challenge.challengeId, signature })
    const data = await listLinkedWallets()
    if (version !== epoch.current) {
      return
    }
    setLinks(data.wallets)
    setMessage(
      action === 'UNLINK'
        ? 'Wallet link revoked. On-chain approvals and signed orders are unchanged.'
        : 'Wallet ownership linked. No trading or transfer permission was granted.',
    )
  }
  return (
    <main className="max-w-3xl mx-auto p-6 space-y-5">
      <a href="/" className="text-[#6C8EF5]">
        Back to KhmerFP
      </a>
      <h1 className="text-2xl font-semibold">Link your Coinbase Smart Wallet</h1>
      <p>
        Base Sepolia test accounts only. This connects wallet ownership to your existing KhmerFP
        account, without granting token or order permissions.
      </p>
      {message && (
        <p role="status" className="border rounded-xl p-3">
          {message}
        </p>
      )}
      {status === 'loading' ? (
        <p>Checking your KhmerFP session...</p>
      ) : !user ? (
        <button onClick={() => setShowAuth(true)}>Sign in to KhmerFP first</button>
      ) : (
        <>
          <p>KhmerFP account: {user.display_name || user.email}</p>
          <button
            disabled={busy}
            className="rounded-lg bg-[#33C7A6] text-black p-3"
            onClick={() =>
              run(async () => {
                await disconnect()
                const version = epoch.current
                const next = await connectUserCoinbaseWallet()
                if (version !== epoch.current) {
                  await next.provider.disconnect?.()
                  return
                }
                connection.current = next
                setWallet(next)
              })
            }
          >
            Connect Coinbase wallet on Base Sepolia
          </button>
          {wallet && (
            <section className="border rounded-xl p-4 space-y-3">
              <p className="break-all">{wallet.address}</p>
              <p>
                {wallet.deployed
                  ? 'Contract deployed; ownership proof still required.'
                  : 'Wallet is undeployed. Linking is blocked; no deployment or funds will be requested.'}
              </p>
              <button disabled={busy} onClick={() => run(disconnect)}>
                Disconnect wallet
              </button>
              <div className="flex gap-3">
                {['LINK', 'UNLINK', 'RELINK'].map((action) => (
                  <button
                    key={action}
                    disabled={busy || !wallet.deployed}
                    onClick={() => run(() => prove(action))}
                  >
                    {action === 'LINK'
                      ? 'Sign ownership link'
                      : action === 'UNLINK'
                        ? 'Sign unlink proof'
                        : 'Sign relink proof'}
                  </button>
                ))}
              </div>
              <p>
                Unlink and relink also require application step-up authentication completed within
                five minutes. Connecting a wallet does not replace that check.
              </p>
            </section>
          )}
          <section>
            <h2 className="font-semibold">Your wallet identities</h2>
            {links.map((link) => (
              <p className="break-all" key={link.id}>
                {link.wallet_address} · {link.chain_id} · {link.wallet_status}
              </p>
            ))}
          </section>
        </>
      )}
      {showAuth && (
        <AuthModal mode={authMode} onModeChange={setAuthMode} onClose={() => setShowAuth(false)} />
      )}
    </main>
  )
}
