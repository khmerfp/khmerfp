import React, { useEffect, useRef, useState } from 'react'
import {
  COINBASE_POC,
  assertPocEnvironment,
  connectCoinbaseProvider,
  createPocRpc,
  inspectCoinbaseAccount,
  signCoinbaseOrder,
} from './coinbaseCompatibility.js'

export default function CoinbaseWalletProbe() {
  const [status, setStatus] = useState(
    'Compatibility proof pending. No transactions are sent by this page.',
  )
  const [account, setAccount] = useState(null),
    [busy, setBusy] = useState(false),
    [result, setResult] = useState(null)
  const provider = useRef(null),
    rpc = useRef(null),
    generation = useRef(0),
    lock = useRef(false),
    removeEvents = useRef(null)
  async function clear() {
    generation.current++
    setAccount(null)
    setResult(null)
    removeEvents.current?.()
    removeEvents.current = null
    const previous = provider.current
    provider.current = null
    rpc.current?.destroy()
    rpc.current = null
    await previous?.disconnect?.()
  }
  useEffect(
    () => () => {
      generation.current++
      removeEvents.current?.()
      rpc.current?.destroy()
      void provider.current?.disconnect?.()
    },
    [],
  )
  async function run(action) {
    if (lock.current) {
      return
    }
    lock.current = true
    setBusy(true)
    try {
      assertPocEnvironment()
      await action()
    } catch (error) {
      setStatus(error.shortMessage || error.message)
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  async function connect() {
    await clear()
    const epoch = ++generation.current
    const { createBaseAccountSDK } = await import('@base-org/account')
    if (epoch !== generation.current) {
      return
    }
    const sdk = createBaseAccountSDK({
      appName: 'KhmerFP Smart Wallet Compatibility',
      appChainIds: [84532],
      preference: { telemetry: false },
      subAccounts: { creation: 'manual', defaultAccount: 'universal', funding: 'manual' },
    })
    const selected = sdk.getProvider()
    if (selected === window.ethereum) {
      throw new Error(
        'This probe requires the Coinbase passkey wallet SDK, not an injected extension. Use a standard browser outside the Coinbase in-app browser.',
      )
    }
    provider.current = selected
    setStatus(
      'Approve the Coinbase passkey connection for Base Sepolia. No transaction is requested.',
    )
    try {
      const address = await connectCoinbaseProvider(selected)
      if (epoch !== generation.current) {
        await selected.disconnect?.()
        return
      }
      const changed = () => {
        void clear()
        setStatus('Account or chain changed. Proof cleared; reconnect to Base Sepolia.')
      }
      for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
        selected.on?.(event, changed)
      }
      removeEvents.current = () => {
        for (const event of ['accountsChanged', 'chainChanged', 'disconnect']) {
          selected.removeListener?.(event, changed)
        }
      }
      rpc.current = createPocRpc()
      const info = await inspectCoinbaseAccount(rpc.current, address)
      if (epoch !== generation.current) {
        return
      }
      setAccount(info)
      setStatus('SDK account obtained. This is not a backend login or a successful trade.')
    } catch (error) {
      await clear()
      throw error
    }
  }
  return (
    <main className="min-h-screen bg-[#0A0E14] text-[#ECEDEF] p-6">
      <div className="max-w-3xl mx-auto space-y-5">
        <h1 className="text-2xl font-semibold">Coinbase Smart Wallet compatibility probe</h1>
        <p className="text-[#F7931A]">DEVELOPMENT ONLY — Base Sepolia — no real funds</p>
        <p>
          This separate page checks the passkey wallet. The working local Bitcoin demo is unchanged.
        </p>
        <p role="status" className="border border-[#F7931A]/40 rounded-xl p-4">
          {status}
        </p>
        <button
          className="rounded-lg bg-[#33C7A6] text-black p-3 disabled:opacity-40"
          disabled={busy}
          onClick={() => run(connect)}
        >
          Connect Coinbase passkey wallet on Base Sepolia
        </button>
        <button
          className="rounded-lg border p-3 ml-2"
          disabled={busy}
          onClick={() =>
            run(async () => {
              await clear()
              setStatus('Disconnected. Probe results cleared.')
            })
          }
        >
          Disconnect
        </button>
        {account && (
          <pre className="whitespace-pre-wrap break-all text-sm border border-[#212832] rounded-xl p-4">
            {JSON.stringify(account, null, 2)}
          </pre>
        )}
        <section className="border border-[#212832] rounded-xl p-4 space-y-3">
          <h2 className="font-semibold">Exact KhmerFP order signing</h2>
          <p>
            Blocked until reviewed testnet deployment addresses, code hashes and a prepared market
            are configured. A connected address alone is not proof of contract compatibility.
          </p>
          <button
            className="rounded-lg bg-[#33C7A6] text-black p-3 disabled:opacity-40"
            disabled={busy || !account || !COINBASE_POC.deployment}
            onClick={() =>
              run(async () => {
                const epoch = generation.current
                const proof = await signCoinbaseOrder(
                  provider.current,
                  rpc.current,
                  COINBASE_POC.deployment,
                  account.address,
                  '1',
                  '0.60',
                )
                if (epoch !== generation.current) {
                  return
                }
                // do not display or persist an executable order signature.
                setResult({
                  digest: proof.digest,
                  verification: proof.verification,
                  settlementVerified: false,
                })
                setStatus(
                  'EIP-1271 diagnostic passed. Exchange settlement and backend authentication are still unverified.',
                )
              })
            }
          >
            Sign and verify test order
          </button>
          {result && (
            <pre className="whitespace-pre-wrap break-all text-sm">
              {JSON.stringify(result, null, 2)}
            </pre>
          )}
        </section>
        <p>
          Hardhat 31337 is not in the pinned SDK default network list. No local Coinbase passkey
          flow has been verified. This page never adds local RPC settings or silently switches the
          local demo to testnet.
        </p>
        <a className="text-[#6C8EF5]" href="/local-demo/bitcoin">
          Return to the local wallet fallback
        </a>
      </div>
    </main>
  )
}
