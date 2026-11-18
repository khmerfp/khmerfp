// simulate wallet behavior only inside the isolated browser test setup.
// this module is substituted only by the standalone test Vite server.
import { assertWalletLinkChallenge } from '../../packages/domain/src/walletLinkProtocol.js'
import { id } from 'ethers'
const address = () => window.__WALLET_E2E_ADDRESS || '0x1111111111111111111111111111111111111111'
const scenario = () => window.__WALLET_E2E_SCENARIO || 'success'
export async function connectUserCoinbaseWallet() {
  await new Promise(resolve => setTimeout(resolve, 150))
  if (scenario() === 'reject-connection') throw Object.assign(new Error('Connection rejected.'), { code: 4001 })
  if (scenario() === 'wrong-network') throw new Error('Base Sepolia is required.')
  const listeners = new Map()
  return { address: address(), chainId: 84532, deployed: scenario() !== 'undeployed', provider: {
    on: (event, callback) => listeners.set(event, callback), removeListener: event => listeners.delete(event), disconnect: async () => {},
  } }
}
export async function signWalletOwnership(connection, data) {
  assertWalletLinkChallenge({ challengeId: data.message.challengeId, typedData: data }, {
    origin: location.origin, wallet: connection.address, userId: data.message.userId, action: data.message.action, domainSalt: id(location.origin),
  })
  await new Promise(resolve => setTimeout(resolve, 150))
  if (scenario() === 'reject-signature') throw Object.assign(new Error('Signature rejected.'), { code: 4001 })
  const response = await fetch('/__test/sign', { method: 'POST', credentials: 'include', headers: {
    'Content-Type': 'application/json', 'X-Wallet-Test-Token': window.__WALLET_E2E_TOKEN,
  }, body: JSON.stringify({ challengeId: data.message.challengeId, scenario: scenario() }) })
  if (!response.ok) throw new Error('Isolated signer unavailable.')
  return (await response.json()).signature
}
