import {
  BrowserProvider,
  Contract,
  JsonRpcProvider,
  TypedDataEncoder,
  getAddress,
  keccak256,
} from 'ethers'
import { amounts, buildOrder, orderTypes } from './demoClient.js'

export const COINBASE_POC = Object.freeze({
  chainId: 84532,
  rpcUrl: 'https://sepolia.base.org',
  sdkPackage: '@base-org/account',
  sdkVersion: '2.6.0',
  // populate only after an approved testnet deployment and configuration review.
  deployment: null,
})
export const ERC6492_SUFFIX = '6492'.repeat(16)
export const isCounterfactualSignature = (signature) =>
  typeof signature === 'string' && signature.toLowerCase().endsWith(ERC6492_SUFFIX)
const exchangeAbi = [
  'function collateral() view returns(address)',
  'function conditionalTokens() view returns(address)',
  'function markets(bytes32) view returns(uint256 yesTokenId,uint256 noTokenId,bool enabled,uint64 tradingCutoff)',
  'function hashOrder((address maker,uint256 tokenId,uint8 side,uint256 makerAmount,uint256 takerAmount,uint256 nonce,uint256 expiration)) view returns(bytes32)',
]

export function assertPocEnvironment() {
  if (!import.meta.env.DEV || !['localhost', '127.0.0.1'].includes(location.hostname)) {
    throw new Error('Coinbase compatibility testing is development-only on a loopback host.')
  }
}

export function assertPocNetwork(chainId) {
  if (BigInt(chainId) !== 84532n) {
    throw new Error(
      'This isolated probe requires explicit Base Sepolia selection (84532). Local Hardhat compatibility is not verified; mainnet is forbidden.',
    )
  }
}

export async function connectCoinbaseProvider(provider) {
  const addresses = await provider.request({ method: 'eth_requestAccounts' })
  if (!Array.isArray(addresses) || !addresses.length) {
    throw new Error('Coinbase did not return an account.')
  }
  if (BigInt(await provider.request({ method: 'eth_chainId' })) !== 84532n) {
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: '0x14a34' }],
    })
  }
  assertPocNetwork(await provider.request({ method: 'eth_chainId' }))
  return getAddress(addresses[0])
}

export async function inspectCoinbaseAccount(rpc, address) {
  assertPocNetwork((await rpc.getNetwork()).chainId)
  const code = await rpc.getCode(getAddress(address))
  return {
    address: getAddress(address),
    chainId: 84532,
    deploymentState: code === '0x' ? 'UNDEPLOYED' : 'DEPLOYED',
    ownershipVerified: false,
    exchangeCompatibilityVerified: false,
    note:
      code === '0x'
        ? 'No code on Base Sepolia. EIP-6492 verification and deployment are not enabled.'
        : 'Contract code exists. This alone does not prove ownership, Coinbase provenance or valid order signatures.',
  }
}

export function requirePocDeployment(deployment) {
  if (!deployment) {
    throw new Error(
      'Signing blocked: no reviewed Base Sepolia exchange, mock collateral and CTF deployment is configured.',
    )
  }
  assertPocNetwork(deployment.chainId)
  if (!deployment.round || !Array.isArray(deployment.tokens) || deployment.tokens.length !== 2) {
    throw new Error('Incomplete binary market configuration.')
  }
  for (const name of ['exchange', 'collateral', 'ctf']) {
    if (
      !deployment.addresses?.[name] ||
      !/^0x[0-9a-f]{64}$/i.test(deployment.codeHashes?.[name] || '')
    ) {
      throw new Error('Reviewed addresses and runtime code hashes are required.')
    }
    getAddress(deployment.addresses[name])
  }
  if (
    !/^0x[0-9a-f]{64}$/i.test(deployment.round.conditionId || '') ||
    !Number.isSafeInteger(deployment.round.tradingCutoff)
  ) {
    throw new Error('Invalid condition or cutoff.')
  }
}

export async function verifyPocDeployment(rpc, deployment) {
  requirePocDeployment(deployment)
  assertPocNetwork((await rpc.getNetwork()).chainId)
  for (const name of ['exchange', 'collateral', 'ctf']) {
    if (keccak256(await rpc.getCode(deployment.addresses[name])) !== deployment.codeHashes[name]) {
      throw new Error('Reviewed deployment code mismatch.')
    }
  }
  const exchange = new Contract(deployment.addresses.exchange, exchangeAbi, rpc)
  const collateral = new Contract(
    deployment.addresses.collateral,
    ['function decimals() view returns(uint8)'],
    rpc,
  )
  const ctf = new Contract(
    deployment.addresses.ctf,
    ['function getOutcomeSlotCount(bytes32) view returns(uint256)'],
    rpc,
  )
  if (
    getAddress(await exchange.collateral()) !== getAddress(deployment.addresses.collateral) ||
    getAddress(await exchange.conditionalTokens()) !== getAddress(deployment.addresses.ctf) ||
    (await collateral.decimals()) !== 6n ||
    (await ctf.getOutcomeSlotCount(deployment.round.conditionId)) !== 2n
  ) {
    throw new Error('Wrong exchange assets or condition.')
  }
  const market = await exchange.markets(deployment.round.conditionId)
  if (
    !market.enabled ||
    market.yesTokenId.toString() !== deployment.tokens[0].tokenId ||
    market.noTokenId.toString() !== deployment.tokens[1].tokenId ||
    market.tradingCutoff.toString() !== String(deployment.round.tradingCutoff)
  ) {
    throw new Error('Market registry mismatch.')
  }
  const latest = await rpc.getBlock('latest')
  if (
    !latest ||
    Math.max(latest.timestamp, Math.floor(Date.now() / 1000)) >= deployment.round.tradingCutoff
  ) {
    throw new Error('Test market is closed.')
  }
  return exchange
}

export async function verifyDeployedOrderSignature(
  rpc,
  account,
  domain,
  order,
  signature,
  expectedExchange,
) {
  assertPocNetwork((await rpc.getNetwork()).chainId)
  assertPocNetwork(domain.chainId)
  if (
    domain.name !== 'KhmerFP Exchange' ||
    domain.version !== '1' ||
    getAddress(order.maker) !== getAddress(account) ||
    getAddress(domain.verifyingContract) !== getAddress(expectedExchange)
  ) {
    throw new Error('Wrong signing domain, verifying contract or maker.')
  }
  if (!/^0x(?:[0-9a-f]{2}){1,4096}$/i.test(signature || '')) {
    throw new Error('Invalid signature encoding or size.')
  }
  if (isCounterfactualSignature(signature)) {
    throw new Error(
      'EIP-6492 envelope detected. Do not unwrap or deploy automatically; exchange support needs separate approval.',
    )
  }
  if ((await rpc.getCode(account)) === '0x') {
    throw new Error('Undeployed wallet cannot pass the current exchange EIP-1271 path.')
  }
  const digest = TypedDataEncoder.hash(domain, orderTypes, order)
  const wallet = new Contract(
    account,
    ['function isValidSignature(bytes32,bytes) view returns(bytes4)'],
    rpc,
  )
  if ((await wallet.isValidSignature(digest, signature)) !== '0x1626ba7e') {
    throw new Error('Smart account rejected the exact KhmerFP order digest.')
  }
  return { digest, verification: 'EIP1271_VALID', settlementVerified: false }
}

export async function signCoinbaseOrder(provider, rpc, deployment, address, quantity, price) {
  const exchange = await verifyPocDeployment(rpc, deployment)
  assertPocNetwork(await provider.request({ method: 'eth_chainId' }))
  const accounts = await provider.request({ method: 'eth_accounts' })
  if (getAddress(accounts[0]) !== getAddress(address)) {
    throw new Error('Wallet account changed.')
  }
  if ((await rpc.getCode(address)) === '0x') {
    throw new Error(
      'Deploying a smart wallet requires a separately approved wallet transaction; signing is blocked for now.',
    )
  }
  const domain = {
    name: 'KhmerFP Exchange',
    version: '1',
    chainId: 84532,
    verifyingContract: deployment.addresses.exchange,
  }
  const order = buildOrder(
    deployment,
    address,
    deployment.tokens[0].tokenId,
    0,
    amounts(quantity, price),
  )
  const digest = TypedDataEncoder.hash(domain, orderTypes, order)
  if ((await exchange.hashOrder(order)) !== digest) {
    throw new Error('Exchange and client order hashes differ.')
  }
  const browser = new BrowserProvider(provider)
  try {
    const signature = await (
      await browser.getSigner(address)
    ).signTypedData(domain, orderTypes, order)
    // account and network must still match after the passkey dialog returns.
    assertPocNetwork(await provider.request({ method: 'eth_chainId' }))
    if (
      getAddress((await provider.request({ method: 'eth_accounts' }))[0]) !== getAddress(address)
    ) {
      throw new Error('Wallet changed while signing.')
    }
    await verifyPocDeployment(rpc, deployment)
    const result = await verifyDeployedOrderSignature(
      rpc,
      address,
      domain,
      order,
      signature,
      deployment.addresses.exchange,
    )
    return { ...result, order, domain, signature }
  } finally {
    browser.destroy()
  }
}

export const createPocRpc = () =>
  new JsonRpcProvider(COINBASE_POC.rpcUrl, 84532, { cacheTimeout: -1 })
