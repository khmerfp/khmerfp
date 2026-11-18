// show public wallet inspection results after a manual connection.
import { createBaseAccountSDK } from '@base-org/account'
import { connectPreparation } from '../connection.js'
import { deploymentReview } from '../deploymentReview.js'

const element = id => document.getElementById(id)
let busy = false
let revision = 0
let publicReport

function clearReport() {
  publicReport = undefined
  element('preview').textContent = ''
  element('deployment-review').textContent = 'Connect the reviewed tester account and complete the read-only inspection first.'
  element('copy').disabled = true
}
async function run(operation) {
  if (busy) return
  busy = true
  for (const id of ['connect', 'inspect']) element(id).disabled = true
  try { await operation() }
  catch (error) {
    clearReport()
    if (error.code === 'PREVIEW_WRONG_CHAIN') {
      element('network').textContent = `Wallet chain: ${error.actualChainId}. Required: Base Sepolia 84532.`
      element('status').textContent = 'Wrong network. Select Base Sepolia manually, then reconnect. No signing or submission occurred.'
    } else {
      element('status').textContent = 'Read unavailable or context rejected. Check the wallet and Base Sepolia network; no deployment was submitted.'
    }
  } finally {
    busy = false
    for (const id of ['connect', 'inspect']) element(id).disabled = false
  }
}
async function inspect(wallet, connection = null) {
  const expectedRevision = revision
  const response = await fetch('/inspect', {
    method: 'POST', credentials: 'omit', cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'X-Preview-Token': document.querySelector('meta[name=preview-token]').content,
    },
    body: JSON.stringify({ wallet }), signal: AbortSignal.timeout(20000),
  })
  if (!response.ok) throw new Error('Read failed.')
  const evidence = await response.json()
  if (revision !== expectedRevision) throw new Error('Wallet context changed.')
  publicReport = {
    inspectedAt: new Date().toISOString(),
    ...evidence,
    sdkConnected: connection !== null,
    capabilityReadStatus: connection?.capabilityReadStatus || 'NOT_REQUESTED',
    capabilities: connection?.capabilities || null,
    sponsorshipCapability: connection?.sponsorshipCapability || 'UNKNOWN',
    firstUseDeploymentVerified: false,
    ownershipVerified: false,
    deploymentMayProceed: false,
    gasAndFunding: 'UNKNOWN; a reviewed operation and a complete fee or sponsorship quote are still required.',
  }
  try {
    publicReport.deploymentReview = deploymentReview(publicReport)
    element('deployment-review').textContent = JSON.stringify(publicReport.deploymentReview, null, 2)
  } catch {
    element('deployment-review').textContent = 'No deployment draft: SDK connection, account identity or deployment state requires review.'
  }
  element('preview').textContent = JSON.stringify(publicReport, null, 2)
  element('copy').disabled = false
  element('status').textContent = 'Read-only inspection complete. Capability support and code presence do not prove first-use deployment or ownership.'
}
element('inspect').onclick = () => run(async () => {
  revision++
  clearReport()
  element('account').textContent = 'Manual public-address read; no SDK account connection is claimed.'
  element('network').textContent = 'RPC requires Base Sepolia 84532.'
  await inspect(element('wallet').value.trim())
})
element('connect').onclick = () => run(async () => {
  revision++
  clearReport()
  const provider = createBaseAccountSDK({
    appName: 'KhmerFP Read-Only Tester Inspection', appChainIds: [84532],
    preference: { telemetry: false },
    subAccounts: { creation: 'manual', defaultAccount: 'universal', funding: 'manual' },
  }).getProvider()
  if (provider === window.ethereum) throw new Error('Injected extension not allowed.')
  const reset = () => {
    revision++
    clearReport()
    element('wallet').value = ''
    element('account').textContent = 'No current account inspection.'
    element('network').textContent = 'Wallet context changed; reconnect on Base Sepolia.'
    element('status').textContent = 'Wallet context changed. Discard the old result and reconnect.'
  }
  provider.on?.('accountsChanged', reset)
  provider.on?.('chainChanged', reset)
  const connection = await connectPreparation(provider)
  element('wallet').value = connection.wallet
  element('account').textContent = `Connected account: ${connection.wallet}. Ownership is not verified.`
  element('network').textContent = `Wallet network: Base Sepolia (${connection.chainId}).`
  await inspect(connection.wallet, connection)
})
element('copy').onclick = async () => {
  if (!publicReport || busy) return
  try {
    await navigator.clipboard.writeText(JSON.stringify(publicReport, null, 2))
    element('status').textContent = 'Public inspection report copied. It contains a public address and block data, not credentials or signatures.'
  } catch { element('status').textContent = 'Clipboard unavailable; the public report remains visible below.' }
}
