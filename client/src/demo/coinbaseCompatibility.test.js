import { describe, it, expect, vi } from 'vitest'
import { Interface, TypedDataEncoder } from 'ethers'
import {
  COINBASE_POC,
  ERC6492_SUFFIX,
  assertPocNetwork,
  connectCoinbaseProvider,
  inspectCoinbaseAccount,
  isCounterfactualSignature,
  requirePocDeployment,
  verifyDeployedOrderSignature,
} from './coinbaseCompatibility.js'
import { orderTypes } from './demoClient.js'

const account = `0x${'11'.repeat(20)}`,
  exchange = `0x${'22'.repeat(20)}`
const domain = {
  name: 'KhmerFP Exchange',
  version: '1',
  chainId: 84532,
  verifyingContract: exchange,
}
const order = {
  maker: account,
  tokenId: '1',
  side: 0,
  makerAmount: '600000',
  takerAmount: '1000000',
  nonce: '1',
  expiration: '9999999999',
}
const signature = '0x1234'
const abi = new Interface(['function isValidSignature(bytes32,bytes) view returns(bytes4)'])
function mockRpc({ chainId = 84532n, code = '0x6000', magic = '0x1626ba7e' } = {}) {
  return {
    getNetwork: vi.fn(async () => ({ chainId })),
    getCode: vi.fn(async () => code),
    call: vi.fn(async () => abi.encodeFunctionResult('isValidSignature', [magic])),
  }
}

describe('Coinbase adapter unit tests - mocked providers, not real passkeys', () => {
  it('pins testnet and leaves deployment approval/configuration unset', () => {
    expect(COINBASE_POC.chainId).toBe(84532)
    expect(COINBASE_POC.deployment).toBeNull()
    expect(() => requirePocDeployment(null)).toThrow(/Signing blocked/)
  })
  it.each([1, 8453, 31337])('rejects unapproved chain %s', (chain) =>
    expect(() => assertPocNetwork(chain)).toThrow(/Base Sepolia/),
  )
  it('connects only through its supplied SDK provider and explicitly selects testnet', async () => {
    let chain = '0x1'
    const provider = {
      request: vi.fn(async ({ method, params }) => {
        if (method === 'eth_requestAccounts') {
          return [account]
        }
        if (method === 'eth_chainId') {
          return chain
        }
        if (method === 'wallet_switchEthereumChain') {
          expect(params).toEqual([{ chainId: '0x14a34' }])
          chain = '0x14a34'
          return null
        }
        throw new Error('Unexpected request')
      }),
    }
    expect(await connectCoinbaseProvider(provider)).toBe(account)
    expect(
      provider.request.mock.calls.every(([call]) => !call.method.includes('sendTransaction')),
    ).toBe(true)
  })
  it('rejects a wallet that remains on the wrong chain', async () => {
    const provider = {
      request: vi.fn(async ({ method }) =>
        method === 'eth_requestAccounts' ? [account] : method === 'eth_chainId' ? '0x1' : null,
      ),
    }
    await expect(connectCoinbaseProvider(provider)).rejects.toThrow(/Base Sepolia/)
  })
  it.each(['0x', '0x6000'])(
    'reports deployment state without claiming ownership or settlement (%s)',
    async (code) => {
      const info = await inspectCoinbaseAccount(mockRpc({ code }), account)
      expect(info.deploymentState).toBe(code === '0x' ? 'UNDEPLOYED' : 'DEPLOYED')
      expect(info.ownershipVerified).toBe(false)
      expect(info.exchangeCompatibilityVerified).toBe(false)
    },
  )
  it('passes the exact EIP-712 digest into ERC-1271 without rewriting it', async () => {
    const rpc = mockRpc()
    const result = await verifyDeployedOrderSignature(
      rpc,
      account,
      domain,
      order,
      signature,
      exchange,
    )
    expect(result.digest).toBe(TypedDataEncoder.hash(domain, orderTypes, order))
    const call = rpc.call.mock.calls[0][0]
    const [hash, supplied] = abi.decodeFunctionData('isValidSignature', call.data)
    expect(hash).toBe(result.digest)
    expect(supplied).toBe(signature)
    expect(result.settlementVerified).toBe(false)
  })
  it.each([
    { ...domain, chainId: 8453 },
    { ...domain, name: 'Other Exchange' },
    { ...domain, verifyingContract: `0x${'33'.repeat(20)}` },
  ])('rejects changed domains before signature verification', async (wrongDomain) => {
    const rpc = mockRpc()
    await expect(
      verifyDeployedOrderSignature(rpc, account, wrongDomain, order, signature, exchange),
    ).rejects.toThrow()
    expect(rpc.call).not.toHaveBeenCalled()
  })
  it('rejects wrong makers, invalid magic and reverted signature calls', async () => {
    await expect(
      verifyDeployedOrderSignature(
        mockRpc(),
        account,
        domain,
        { ...order, maker: exchange },
        signature,
        exchange,
      ),
    ).rejects.toThrow(/maker/)
    await expect(
      verifyDeployedOrderSignature(
        mockRpc({ magic: '0xffffffff' }),
        account,
        domain,
        order,
        signature,
        exchange,
      ),
    ).rejects.toThrow(/rejected/)
    const rpc = mockRpc()
    rpc.call.mockRejectedValue(new Error('Wallet revoked permission'))
    await expect(
      verifyDeployedOrderSignature(rpc, account, domain, order, signature, exchange),
    ).rejects.toThrow(/revoked/)
  })
  it('rejects undeployed accounts instead of treating the owner EOA as the maker', async () => {
    await expect(
      verifyDeployedOrderSignature(
        mockRpc({ code: '0x' }),
        account,
        domain,
        order,
        signature,
        exchange,
      ),
    ).rejects.toThrow(/Undeployed/)
  })
  it('detects ERC-6492 but never unwraps it or executes factory calldata', async () => {
    const wrapped = `0x1234${ERC6492_SUFFIX}`
    expect(isCounterfactualSignature(wrapped)).toBe(true)
    expect(isCounterfactualSignature(signature)).toBe(false)
    const rpc = mockRpc()
    await expect(
      verifyDeployedOrderSignature(rpc, account, domain, order, wrapped, exchange),
    ).rejects.toThrow(/6492/)
    expect(rpc.call).not.toHaveBeenCalled()
  })
})
