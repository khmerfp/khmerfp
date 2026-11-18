// read deployment status and verify the reviewed factory and implementation.
﻿import { Contract, FetchRequest, Interface, JsonRpcProvider, getAddress, keccak256 } from 'ethers'

// official v1.1 factory, checked against the SDK, upstream README and Base Sepolia.
export const CHAIN_ID = 84532
export const FACTORY = '0xBA5ED110eFDBa3D005bfC882d75358ACBbB85842'
export const IMPLEMENTATION = '0x00000110dCdEdC9581cb5eCB8467282f2926534d'
export const FACTORY_HASH = '0xb60a629aa7c6af9b550871fd21b67ab84638156683cec68491049cb5d235ed2f'
export const IMPLEMENTATION_HASH = '0x136185896fc519277ec953c0b3d048fc0c9f607b8d04022e60f23ef8dbc6c4d5'
export const ORIGIN = 'http://127.0.0.1:5185'
export const FACTORY_ABI = [
  'function implementation() view returns(address)',
  'function getAddress(bytes[] owners,uint256 nonce) view returns(address)',
  'function createAccount(bytes[] owners,uint256 nonce) payable returns(address)',
]
const factoryInterface = new Interface(FACTORY_ABI)

export function publicWallet(value) {
  const wallet = getAddress(value)
  if (/^0x0{40}$/i.test(wallet)) throw new Error('A nonzero public wallet is required.')
  return wallet
}

// transaction methods and arbitrary contract calls are absent from this transport.
export function readOnlyFactory() {
  const request = new FetchRequest('https://sepolia.base.org')
  request.timeout = 5000
  class PreviewProvider extends JsonRpcProvider {
    async send(method, params) {
      if (!['eth_chainId', 'eth_getBlockByNumber', 'eth_getCode', 'eth_getBalance', 'eth_call'].includes(method)) {
        throw new Error('Read-only preview method rejected.')
      }
      if (method === 'eth_call') {
        const call = params[0]
        const allowed = ['implementation', 'getAddress'].map(name => factoryInterface.getFunction(name).selector)
        if (getAddress(call.to) !== FACTORY || !allowed.includes(call.data?.slice(0, 10)) ||
            Object.keys(call).some(key => !['to', 'data', 'gas'].includes(key))) {
          throw new Error('Only factory implementation/address reads are allowed.')
        }
      }
      return super.send(method, params)
    }
  }
  return new PreviewProvider(request, CHAIN_ID, { cacheTimeout: -1, batchMaxCount: 1 })
}

export async function inspectDeployment(value, { rpcFactory = readOnlyFactory, timeoutMs = 15000 } = {}) {
  const wallet = publicWallet(value)
  let rpc, timer
  try {
    rpc = rpcFactory()
    return await Promise.race([
      (async () => {
        if ((await rpc.getNetwork()).chainId !== BigInt(CHAIN_ID)) throw new Error('Wrong network.')
        const block = await rpc.getBlock('latest')
        if (!block || !Number.isSafeInteger(block.number) || !/^0x[0-9a-f]{64}$/i.test(block.hash)) throw new Error('Missing block evidence.')
        const factoryCode = await rpc.getCode(FACTORY, block.number)
        if (factoryCode === '0x' || keccak256(factoryCode) !== FACTORY_HASH) throw new Error('Factory identity changed.')
        const factory = new Contract(FACTORY, FACTORY_ABI, rpc)
        const implementation = await factory.implementation({ blockTag: block.number, gasLimit: 100000 })
        if (getAddress(implementation) !== IMPLEMENTATION) throw new Error('Factory implementation changed.')
        const implementationCode = await rpc.getCode(implementation, block.number)
        if (implementationCode === '0x' || keccak256(implementationCode) !== IMPLEMENTATION_HASH) throw new Error('Implementation identity changed.')
        const walletCode = await rpc.getCode(wallet, block.number)
        const balance = await rpc.getBalance(wallet, block.number)
        if ((await rpc.getBlock(block.number))?.hash !== block.hash) throw new Error('Block changed.')
        return {
          wallet, chainId: CHAIN_ID, factory: FACTORY, implementation: IMPLEMENTATION,
          factoryVerifiedAtBlock: block.number, blockHash: block.hash,
          factoryCodeHash: FACTORY_HASH, implementationCodeHash: IMPLEMENTATION_HASH,
          deploymentStatus: walletCode === '0x' ? 'NO_CODE' : walletCode.toLowerCase().startsWith('0xef0100') ? 'DELEGATED_ACCOUNT_REQUIRES_REVIEW' : 'CODE_PRESENT_ACCOUNT_IDENTITY_PENDING',
          balanceWei: balance.toString(),
          owners: null, deploymentNonce: null, predictedAddress: null,
          gasEstimate: null, maximumFeeWei: null, sponsored: null,
          submissionEnabled: false,
          blockers: ['Exact account first-use deployment support on Base Sepolia is unverified.',
            'Raw owners and factory nonce are required for a direct factory workflow, not inherently for wallet-managed execution.',
            'No account-specific operation review, gas quote or sponsorship commitment is available.'],
        }
      })(),
      new Promise((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Read-only inspection timed out.')), timeoutMs) }),
    ])
  } finally { clearTimeout(timer); rpc?.destroy() }
}

// future adapter utility only: callers need authentic SDK metadata for this exact account.
// this does not discover owners, prove their control, or authorize submission.
export async function compareSdkFactoryData({ wallet, factory, factoryData }, predict) {
  if (getAddress(factory) !== FACTORY) throw new Error('Unexpected SDK factory.')
  const decoded = factoryInterface.parseTransaction({ data: factoryData })
  if (decoded?.name !== 'createAccount') throw new Error('Unexpected factory method.')
  const [owners, nonce] = decoded.args
  if (!owners.length || owners.length > 10 || owners.some(owner => !/^0x(?:[0-9a-f]{64}|[0-9a-f]{128})$/i.test(owner))) {
    throw new Error('Unsupported owner encoding requires review.')
  }
  for (const owner of owners) {
    if (owner.length === 66) publicWallet(`0x${owner.slice(-40)}`)
    if (owner.length === 66 && !/^0x0{24}/i.test(owner)) throw new Error('Noncanonical address owner.')
  }
  const encoded = factoryInterface.encodeFunctionData('createAccount', [owners, nonce])
  if (encoded.toLowerCase() !== factoryData.toLowerCase()) throw new Error('Noncanonical factory calldata.')
  const expected = publicWallet(wallet)
  const predicted = getAddress(await predict([...owners], nonce))
  if (predicted !== expected) throw new Error('Predicted account differs from SDK account.')
  return { predictedAddress: predicted, ownerCount: owners.length, deploymentNonce: nonce.toString() }
}
