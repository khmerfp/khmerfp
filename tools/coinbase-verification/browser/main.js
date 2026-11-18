// connect and request ownership signing only through explicit user actions.
﻿import { createBaseAccountSDK } from '@base-org/account'
import { getAddress, id } from 'ethers'
import { signWalletOwnership } from '../../../client/src/services/coinbaseWallet.js'
import { assertWalletLinkChallenge } from '../../../packages/domain/src/walletLinkProtocol.js'

import { guardWalletProvider } from '../walletGuard.js'

async function main() {
  const element = (name) => document.getElementById(name)
  const config = await fetch('/config', { credentials: 'omit', cache: 'no-store' }).then(response => response.json())
  let provider, connection, challenge, busy = false
  const checkChallenge = () => assertWalletLinkChallenge(challenge, {
    origin: config.origin, wallet: config.wallet, userId: '1', action: 'LINK', domainSalt: id(config.origin),
  })
  function ready() {
    const approved = element('approval').checked && !busy
    for (const name of ['preflight', 'connect', 'challenge']) element(name).disabled = !approved
    element('sign').disabled = !approved || !connection || !challenge
  }
  function clear() { connection = undefined; challenge = undefined; element('payload').textContent = ''; ready() }
  async function post(url, body = {}) {
    const response = await fetch(url, { method: 'POST', credentials: 'omit', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Probe-Token': document.querySelector('meta[name=probe-token]').content }, body: JSON.stringify(body) })
    const result = await response.json()
    if (!response.ok) throw new Error(result.error)
    return result
  }
  async function run(task) {
    if (busy || !element('approval').checked) return
    busy = true; ready()
    try { await task() } catch { clear(); element('status').textContent = 'Attempt stopped. Check wallet, network, expiry and deployment; request a fresh challenge.' }
    finally { busy = false; ready() }
  }
  element('approval').onchange = () => { if (!element('approval').checked) clear(); ready() }
  element('preflight').onclick = () => run(async () => { element('evidence').textContent = JSON.stringify(await post('/preflight'), null, 2) })
  element('connect').onclick = () => run(async () => {
    clear()
    await post('/preflight')
    provider = createBaseAccountSDK({ appName: 'KhmerFP Isolated Ownership Test', appChainIds: [84532],
      preference: { telemetry: false }, subAccounts: { creation: 'manual', defaultAccount: 'universal', funding: 'manual' } }).getProvider()
    if (provider === window.ethereum) throw new Error('Injected wallet is not allowed.')
    const raw = provider
    const guarded = guardWalletProvider(raw, { wallet: config.wallet, origin: config.origin, getChallenge: () => challenge, isApproved: () => element('approval').checked })
    const accounts = await guarded.request({ method: 'eth_requestAccounts' })
    if (getAddress(accounts[0]) !== config.wallet || BigInt(await guarded.request({ method: 'eth_chainId' })) !== 84532n) throw new Error('Account or chain mismatch.')
    connection = { address: config.wallet, provider: guarded }
    raw.on?.('accountsChanged', clear); raw.on?.('chainChanged', clear)
    element('status').textContent = 'Expected account connected. Connection alone is not ownership proof. Create a challenge next.'
  })
  element('challenge').onclick = () => run(async () => {
    if (!connection) throw new Error('Connect first.')
    challenge = await post('/challenge')
    checkChallenge()
    element('payload').textContent = JSON.stringify(challenge.typedData, null, 2)
    element('status').textContent = 'Review the synthetic ownership payload; it expires in 120 seconds. Signing is a separate click.'
  })
  element('sign').onclick = () => run(async () => {
    checkChallenge()
    await post('/preflight')
    const active = connection, original = challenge
    let signature = await signWalletOwnership(active, original.typedData)
    try {
      if (connection !== active || challenge !== original || !element('approval').checked) throw new Error('Context changed.')
      checkChallenge()
      const evidence = await post('/verify', { challenge: original, walletAddress: config.wallet, signature })
      element('evidence').textContent = JSON.stringify(evidence, null, 2)
      element('status').textContent = 'Ownership signature accepted at the reported block. No application linking or trading permission was granted.'
    } finally { signature = undefined; challenge = undefined; element('payload').textContent = '' }
  })
  ready()

}
main().catch(() => { document.getElementById('status').textContent = 'Harness unavailable. No signing request was made.' })
