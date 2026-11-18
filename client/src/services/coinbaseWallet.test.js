// test wallet connection and network checks with a simulated provider.
import { beforeEach, expect, it, vi } from 'vitest'
const state = vi.hoisted(() => ({ network: 84532n, code: '0x6000', chain: '0x14a34' }))
const provider = vi.hoisted(() => ({ request: vi.fn(), disconnect: vi.fn() }))
const createSdk = vi.hoisted(() => vi.fn())
vi.mock('@base-org/account', () => ({ createBaseAccountSDK: createSdk }))
vi.mock('ethers', async () => {
  const actual = await vi.importActual('ethers')
  return { ...actual, JsonRpcProvider: class {
    async getNetwork() { return { chainId: state.network } }
    async getBlock() { return { number: 1, hash: '0x' + '11'.repeat(32) } }
    async getCode() { return state.code }
    destroy() {}
  } }
})
import { connectUserCoinbaseWallet, signWalletOwnership } from './coinbaseWallet.js'
const address = '0x1111111111111111111111111111111111111111'
beforeEach(() => {
  state.network = 84532n; state.code = '0x6000'; state.chain = '0x14a34'
  vi.clearAllMocks()
  createSdk.mockReturnValue({ getProvider: () => provider })
  provider.request.mockImplementation(async ({ method }) => {
    if (['eth_requestAccounts', 'eth_accounts'].includes(method)) return [address]
    if (method === 'eth_chainId') return state.chain
    if (method === 'wallet_switchEthereumChain') return null
    throw new Error('Unexpected wallet method')
  })
})
it('returns checked connection metadata without signing or submission', async () => {
  expect(await connectUserCoinbaseWallet()).toMatchObject({ address, deployed: true, chainId: 84532 })
  expect(provider.request.mock.calls.every(([call]) => !/sign|send/i.test(call.method))).toBe(true)
})
it('reports an undeployed account without deployment', async () => {
  state.code = '0x'
  expect((await connectUserCoinbaseWallet()).deployed).toBe(false)
})
it('rejects a wrong RPC network', async () => {
  state.network = 8453n
  await expect(connectUserCoinbaseWallet()).rejects.toThrow('Wallet read network mismatch')
  expect(provider.disconnect).toHaveBeenCalled()
})
it('rejects a wallet that stays on the wrong chain', async () => {
  state.chain = '0x2105'
  await expect(connectUserCoinbaseWallet()).rejects.toThrow('Base Sepolia is required')
})
it('disconnects after a rejected connection', async () => {
  provider.request.mockRejectedValueOnce(Object.assign(new Error('Rejected'), { code: 4001 }))
  await expect(connectUserCoinbaseWallet()).rejects.toMatchObject({ code: 4001 })
  expect(provider.disconnect).toHaveBeenCalled()
})
it('rejects an account change during the deployment check', async () => {
  const previous = provider.request.getMockImplementation()
  provider.request.mockImplementation(async request => request.method === 'eth_accounts'
    ? ['0x2222222222222222222222222222222222222222'] : previous(request))
  await expect(connectUserCoinbaseWallet()).rejects.toThrow('Wallet account or network changed')
})

it('rejects a zero wallet address before checking deployment', async () => {
  provider.request.mockResolvedValueOnce(['0x' + '0'.repeat(40)])
  await expect(connectUserCoinbaseWallet()).rejects.toThrow('A valid nonzero wallet address is required')
})

it('uses the official hosted provider without creating subaccounts or requesting signing', async () => {
  await connectUserCoinbaseWallet()
  expect(createSdk).toHaveBeenCalledWith(expect.objectContaining({
    appChainIds: [84532], subAccounts: { creation: 'manual', defaultAccount: 'universal', funding: 'manual' },
  }))
  expect(provider.request).toHaveBeenCalledWith({ method: 'eth_requestAccounts' })
  expect(provider.request.mock.calls.some(([r]) => /sign|send|addSubAccount/i.test(r.method))).toBe(false)
})
it('rejects an empty account response with a useful error', async () => {
  provider.request.mockResolvedValueOnce([])
  await expect(connectUserCoinbaseWallet()).rejects.toThrow('No Coinbase wallet account was selected')
  expect(provider.disconnect).toHaveBeenCalledOnce()
})
it('a cancelled connection never opens a new hosted prompt', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(connectUserCoinbaseWallet({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(provider.request).not.toHaveBeenCalled()
})
it('cancellation while the hosted prompt is pending blocks subsequent wallet methods', async () => {
  const controller = new AbortController()
  provider.request.mockImplementationOnce(async () => { controller.abort(); return [address] })
  await expect(connectUserCoinbaseWallet({ signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(provider.request).toHaveBeenCalledTimes(1)
  expect(provider.disconnect).toHaveBeenCalledOnce()
})
it('cleanup failure does not hide the hosted connection rejection', async () => {
  provider.request.mockRejectedValueOnce(Object.assign(new Error('User rejected'), { code: 4001 }))
  provider.disconnect.mockRejectedValueOnce(new Error('Cleanup failed'))
  await expect(connectUserCoinbaseWallet()).rejects.toMatchObject({ code: 4001 })
})
it('the signing helper itself refuses undeployed wallets', async () => {
  await expect(signWalletOwnership({ provider, address, deployed: false }, {})).rejects.toThrow('deployed smart wallet is required')
  expect(provider.request).not.toHaveBeenCalled()
})
