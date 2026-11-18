// use simulated public reads; never connect, sign or submit to a real wallet.
import { beforeEach, expect, it, vi } from 'vitest'
import { inspectCoinbaseWalletSetup, WALLET_SETUP_STATES } from './coinbaseWalletSetup.js'

const address = '0x1111111111111111111111111111111111111111'
const hash = '0x' + '11'.repeat(32)
let provider, rpc, options, connection
beforeEach(() => {
  provider = { request: vi.fn(async ({ method }) => {
    if (method === 'eth_accounts') return [address]
    if (method === 'eth_chainId') return '0x14a34'
    throw new Error('Forbidden wallet method: ' + method)
  }) }
  rpc = {
    getNetwork: vi.fn(async () => ({ chainId: 84532n })),
    getBlock: vi.fn(async () => ({ number: 5, hash })),
    getCode: vi.fn(async () => '0x'), destroy: vi.fn(),
  }
  options = { rpcFactory: () => rpc }
  connection = { address, provider }
})
it('reports disconnection without any wallet request', async () => {
  expect((await inspectCoinbaseWalletSetup(null, options)).state).toBe('DISCONNECTED')
  expect(provider.request).not.toHaveBeenCalled()
})
it('keeps an undeployed wallet unavailable even when capability flags might be supported', async () => {
  const result = await inspectCoinbaseWalletSetup(connection, options)
  expect(result).toMatchObject({ state: 'SETUP_UNAVAILABLE', setupRequired: true, deployed: false, submissionEnabled: false, maximumCostWei: null, setupMechanism: null })
  expect(provider.request.mock.calls.map(([r]) => r.method)).toEqual(['eth_accounts', 'eth_chainId', 'eth_accounts', 'eth_chainId'])
  expect(rpc.getCode).toHaveBeenCalledWith(address, 5)
  expect(rpc.destroy).toHaveBeenCalledOnce()
})
it('code presence is not ownership or verified account identity', async () => {
  rpc.getCode.mockResolvedValue('0x6000')
  expect(await inspectCoinbaseWalletSetup(connection, options)).toMatchObject({ state: 'CODE_DETECTED', deployed: true, ownershipVerified: false, submissionEnabled: false })
})
it('rejects a mismatched wallet network', async () => {
  provider.request.mockImplementation(async ({ method }) => method === 'eth_accounts' ? [address] : '0x2105')
  await expect(inspectCoinbaseWalletSetup(connection, options)).rejects.toThrow('Base Sepolia is required')
  expect(rpc.getCode).not.toHaveBeenCalled()
})
it('rejects a mismatched rpc network', async () => {
  rpc.getNetwork.mockResolvedValue({ chainId: 8453n })
  await expect(inspectCoinbaseWalletSetup(connection, options)).rejects.toThrow('Wallet read network mismatch')
  expect(rpc.destroy).toHaveBeenCalledOnce()
})
it('rejects an account change during the check', async () => {
  provider.request.mockResolvedValueOnce([address]).mockResolvedValueOnce('0x14a34').mockResolvedValueOnce(['0x2222222222222222222222222222222222222222'])
  await expect(inspectCoinbaseWalletSetup(connection, options)).rejects.toThrow('account or network changed')
})
it('rejects cancellation without signing or further reads', async () => {
  const controller = new AbortController()
  controller.abort()
  await expect(inspectCoinbaseWalletSetup(connection, { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(provider.request).not.toHaveBeenCalled()
})
it('discards a cancelled in-flight read', async () => {
  const controller = new AbortController()
  rpc.getCode.mockImplementation(async () => { controller.abort(); return '0x6000' })
  await expect(inspectCoinbaseWalletSetup(connection, { ...options, signal: controller.signal })).rejects.toMatchObject({ name: 'AbortError' })
  expect(rpc.destroy).toHaveBeenCalledOnce()
})
it('rpc failures never produce deployment success', async () => {
  rpc.getCode.mockRejectedValue(new Error('RPC offline'))
  expect(await inspectCoinbaseWalletSetup(connection, options)).toMatchObject({ state: 'SETUP_UNAVAILABLE', deployed: false })
})
it('changed block evidence stays unavailable', async () => {
  rpc.getBlock.mockResolvedValueOnce({ number: 5, hash }).mockResolvedValueOnce({ number: 5, hash: '0x' + '22'.repeat(32) })
  expect((await inspectCoinbaseWalletSetup(connection, options)).state).toBe('SETUP_UNAVAILABLE')
})
it('malformed code cannot imply deployment', async () => {
  rpc.getCode.mockResolvedValue(null)
  expect((await inspectCoinbaseWalletSetup(connection, options)).deployed).toBe(false)
})
it('timeouts fail closed and release rpc resources', async () => {
  rpc.getCode.mockImplementation(() => new Promise(() => {}))
  expect((await inspectCoinbaseWalletSetup(connection, { ...options, timeoutMs: 5 })).state).toBe('SETUP_UNAVAILABLE')
  expect(rpc.destroy).toHaveBeenCalledOnce()
})
it('reserved review and confirmation states cannot be reached from empty code', async () => {
  const result = await inspectCoinbaseWalletSetup(connection, options)
  expect([WALLET_SETUP_STATES.SETUP_READY_FOR_REVIEW, WALLET_SETUP_STATES.SETUP_PENDING_CONFIRMATION, WALLET_SETUP_STATES.DEPLOYED_AND_VERIFIED, WALLET_SETUP_STATES.OWNERSHIP_VERIFIED, WALLET_SETUP_STATES.LINKED]).not.toContain(result.state)
})
