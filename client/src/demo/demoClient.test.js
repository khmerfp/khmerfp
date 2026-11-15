import { describe, it, expect, vi, afterEach } from 'vitest'
import { Interface, keccak256 } from 'ethers'
import { amounts, buildOrder, orderTypes, fingerprint, requireLocal, api, authenticate, API, connectWallet, selectLocalChain, checkWalletDeployment } from './demoClient.js'
describe('local demo order arithmetic',()=>{
  it('uses exact six-decimal integers for buy and sell limits',()=>{
    expect(amounts('1','0.65')).toEqual({quantity:'1000000',payment:'650000'})
    expect(amounts('2.5','0.6')).toEqual({quantity:'2500000',payment:'1500000'})
    expect(amounts('10000000000000000','0.5').payment).toBe('5000000000000000000000')
  })
  it.each([['0','0.6'],['-1','0.6'],['1','1'],['1','0'],['1e3','0.6'],['NaN','0.6'],['1.0000001','0.6'],['0.000001','0.5']])('rejects invalid quantity/price %s %s',(q,p)=>expect(()=>amounts(q,p)).toThrow())
  const c={round:{tradingCutoff:100},tokens:[{tokenId:'123'}]}
  it('builds the exact exchange order fields for both sides',()=>{
    const fill=amounts('2','0.6')
    const buy=buildOrder(c,'wallet','123',0,fill,1000),sell=buildOrder(c,'wallet','123',1,fill,1000)
    expect(Object.keys(buy).sort()).toEqual(orderTypes.Order.map(f=>f.name).sort())
    expect(buy).toMatchObject({makerAmount:'1200000',takerAmount:'2000000',expiration:'100'})
    expect(sell).toMatchObject({makerAmount:'2000000',takerAmount:'1200000'})
    expect(buy.nonce).not.toBe(sell.nonce)
  })
  it('rejects cutoff boundaries and unknown outcome tokens',()=>{
    expect(()=>buildOrder(c,'wallet','123',0,amounts('1','0.6'),100000)).toThrow(/cutoff/)
    expect(()=>buildOrder(c,'wallet','999',0,amounts('1','0.6'),1000)).toThrow(/Invalid/)
  })
  it('detects deployment resets even when addresses are reused',()=>{
    expect(fingerprint({...c,instanceId:'one'})).not.toBe(fingerprint({...c,instanceId:'two'}))
  })
  it('rejects non-loopback UI hosts',()=>expect(()=>requireLocal()).toThrow(/127.0.0.1/))
})
describe('demo transport and wallet proofs',()=>{
  it('always uses the loopback API and a separate cookie session',async()=>{
    vi.stubGlobal('location',{hostname:'127.0.0.1'})
    const fetch=vi.fn().mockResolvedValue({ok:true,json:async()=>[]});vi.stubGlobal('fetch',fetch)
    await api('/orders')
    expect(fetch).toHaveBeenCalledWith(API+'/orders',expect.objectContaining({credentials:'include'}))
    expect(API).toBe('http://127.0.0.1:4001/api/demo')
  })
  it('rejects a changed login exchange before asking for a signature',async()=>{
    vi.stubGlobal('location',{hostname:'127.0.0.1'})
    vi.stubGlobal('fetch',vi.fn().mockResolvedValue({ok:true,json:async()=>({nonce:'nonce',message:`KhmerFP local demo login\nChain: 31337\nExchange: attacker\nWallet: wallet\nNonce: nonce\nExpires: ${Date.now()+60000}`})}))
    const signer={signMessage:vi.fn()}
    await expect(authenticate({wallet:'wallet',signer},{addresses:{exchange:'expected'}})).rejects.toThrow(/challenge/)
    expect(signer.signMessage).not.toHaveBeenCalled()
  })
  it('rejects missing wallets',async()=>await expect(connectWallet(null,{})).rejects.toThrow(/EIP-1193/))
  it('requests a switch when a network was added but not selected', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    let chain = '0x1'
    const request = vi.fn(async ({ method }) => {
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') chain = '0x7a69'
    })
    await selectLocalChain({ request })
    expect(request).toHaveBeenCalledWith({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x7a69' }] })
    expect(request.mock.calls.some(([call]) => call.method === 'wallet_addEthereumChain')).toBe(false)
  })
  it('adds only the fixed local network when the wallet does not know it', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    let known = false, chain = '0x1'
    const request = vi.fn(async ({ method }) => {
      if (method === 'eth_chainId') return chain
      if (method === 'wallet_switchEthereumChain') {
        if (!known) throw Object.assign(new Error('Unknown chain'), { code: 4902 })
        chain = '0x7a69'
      }
      if (method === 'wallet_addEthereumChain') known = true
    })
    await selectLocalChain({ request })
    expect(request).toHaveBeenCalledWith({ method: 'wallet_addEthereumChain', params: [{
      chainId: '0x7a69', chainName: 'Hardhat Local Demo',
      nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: ['http://127.0.0.1:8545'],
    }] })
  })
  it('does not prompt when the local network is already selected', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    const request = vi.fn().mockResolvedValue('0x7a69')
    await selectLocalChain({ request })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('preserves a rejected switch and does not try to add another network', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    const error = Object.assign(new Error('User declined switch'), { code: 4001 })
    const request = vi.fn().mockResolvedValueOnce('0x1').mockRejectedValueOnce(error)
    await expect(selectLocalChain({ request })).rejects.toBe(error)
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('fails closed if the wallet reports success but remains on the wrong chain', async () => {
    vi.stubGlobal('location', { hostname: '127.0.0.1' })
    const request = vi.fn(async ({ method }) => method === 'eth_chainId' ? '0x1' : null)
    await expect(selectLocalChain({ request })).rejects.toThrow(/still reports chain 1/)
  })
})
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllGlobals()})

describe('wallet deployment comparison', () => {
  const config = { deploymentBlock: 15 }
  it('accepts matching public block hashes', async () => {
    const local = { send: vi.fn().mockResolvedValue({ hash: 'current' }) }
    const wallet = { request: vi.fn().mockResolvedValue({ hash: 'current' }) }
    await expect(checkWalletDeployment(wallet, local, config)).resolves.toBeUndefined()
    expect(wallet.request).toHaveBeenCalledWith({ method: 'eth_getBlockByNumber', params: ['0xf', false] })
    expect(wallet.request).toHaveBeenCalledTimes(1)
  })
  it.each([true, false])('rejects a hash match without canonical state proof (%s)', async recognized => {
    const local = { send: vi.fn().mockResolvedValue({ hash: 'current' }) }
    const wallet = { request: vi.fn().mockResolvedValueOnce({ hash: 'old' }).mockResolvedValueOnce(recognized ? { hash: 'current', number: '0xf' } : null) }
    await expect(checkWalletDeployment(wallet, local, config)).rejects.toMatchObject({
      connectionDetails: { deploymentBlock: 15, localBlockHash: 'current', walletBlockHash: 'old', walletRecognizesCurrentBlockByHash: recognized },
    })
    expect(wallet.request.mock.calls.map(([call]) => call.method)).toEqual(['eth_getBlockByNumber', 'eth_getBlockByHash'])
  })
  it('rejects missing local blocks and does not query an undefined hash', async () => {
    const wallet = { request: vi.fn().mockResolvedValue({ hash: 'old' }) }
    await expect(checkWalletDeployment(wallet, { send: async () => null }, config)).rejects.toMatchObject({ connectionDetails: { localBlockHash: null } })
    expect(wallet.request).toHaveBeenCalledTimes(1)
  })
  it('keeps the original mismatch blocking when the optional diagnostic is unsupported', async () => {
    const wallet = { request: vi.fn().mockResolvedValueOnce({ hash: 'old' }).mockRejectedValueOnce(new Error('Unsupported')) }
    await expect(checkWalletDeployment(wallet, { send: async () => ({ hash: 'current' }) }, config)).rejects.toMatchObject({ connectionDetails: { walletRecognizesCurrentBlockByHash: null } })
  })
})

describe('canonical wallet verification after a local reset', () => {
  const registry = new Interface(['function markets(bytes32) view returns(uint256 yesTokenId,uint256 noTokenId,bool enabled,uint64 tradingCutoff)'])
  const code = '0x60016000'
  const block = { hash: `0x${'ab'.repeat(32)}`, number: '0xf' }
  const config = {
    deploymentBlock: 15,
    addresses: { exchange: `0x${'11'.repeat(20)}`, collateral: `0x${'22'.repeat(20)}`, ctf: `0x${'33'.repeat(20)}` },
    codeHashes: Object.fromEntries(['exchange', 'collateral', 'ctf'].map(key => [key, keccak256(code)])),
    tokens: [{ tokenId: '1' }, { tokenId: '2' }], round: { conditionId: `0x${'44'.repeat(32)}`, tradingCutoff: 300 },
  }
  function fixture({ market = [1, 2, true, 300], wrongCode = false, rejectCanonical = false, divergentState = false } = {}) {
    const encoded = registry.encodeFunctionResult('markets', market)
    const correct = registry.encodeFunctionResult('markets', [1, 2, true, 300])
    const local = { send: vi.fn(async method => method === 'eth_getBlockByNumber' ? block : divergentState ? correct : encoded) }
    const wallet = { request: vi.fn(async ({ method }) => {
      if (method === 'eth_getBlockByNumber') return { hash: 'stale', number: '0xf' }
      if (method === 'eth_getBlockByHash') return block
      if (rejectCanonical) throw new Error('Block is not canonical')
      if (method === 'eth_getCode') return wrongCode ? '0x6002' : code
      if (method === 'eth_call') return divergentState ? '0x' : encoded
      throw new Error('Unexpected wallet request')
    }) }
    return { local, wallet }
  }
  it('accepts stale numbered data only after canonical code and market state match', async () => {
    const { local, wallet } = fixture()
    await expect(checkWalletDeployment(wallet, local, config)).resolves.toBeUndefined()
    const anchored = wallet.request.mock.calls.map(([call]) => call).filter(call => ['eth_getCode', 'eth_call'].includes(call.method))
    expect(anchored).toHaveLength(4)
    for (const call of anchored) expect(call.params[1]).toEqual({ blockHash: block.hash, requireCanonical: true })
    expect(local.send).toHaveBeenCalledWith('eth_call', expect.any(Array))
    expect(wallet.request.mock.calls.every(([call]) => !call.method.includes('sign') && !call.method.includes('sendTransaction'))).toBe(true)
  })
  it.each([
    { wrongCode: true }, { rejectCanonical: true }, { divergentState: true },
    { market: [9, 2, true, 300] }, { market: [1, 2, true, 301] }, { market: [1, 2, false, 300] },
  ])('rejects incomplete or different canonical state %j', async options => {
    const { local, wallet } = fixture(options)
    await expect(checkWalletDeployment(wallet, local, config)).rejects.toMatchObject({ connectionDetails: { canonicalStateVerified: false } })
  })
})
