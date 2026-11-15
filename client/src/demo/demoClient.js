import { BrowserProvider, Contract, Interface, JsonRpcProvider, formatUnits, keccak256, id } from 'ethers'

export const API = 'http://127.0.0.1:4001/api/demo'
export const orderTypes = { Order: [['maker','address'],['tokenId','uint256'],['side','uint8'],['makerAmount','uint256'],['takerAmount','uint256'],['nonce','uint256'],['expiration','uint256']].map(([name,type]) => ({name,type})) }
export const display = value => formatUnits(value ?? 0n, 6)
export const fingerprint = c => JSON.stringify([c.instanceId,c.addresses,c.round.roundId,c.round.tradingCutoff])
export function requireLocal() {
  if (!import.meta.env.DEV || location.hostname !== '127.0.0.1') throw new Error('Open http://127.0.0.1:5173/local-demo/bitcoin in development.')
}
export async function api(path, body) {
  requireLocal()
  const response = await fetch(API + path, {method: body === undefined ? 'GET':'POST',credentials:'include',headers:{'Content-Type':'application/json'},...(body === undefined ? {} : {body:JSON.stringify(body)}),signal:AbortSignal.timeout(20000)})
  const data = await response.json()
  if (!response.ok) { const error = new Error(data.message || 'Local demo request failed.'); error.status=response.status; throw error }
  return data
}
export function amounts(quantity, price) {
  const parse = value => {
    if (!/^(0|[1-9]\d{0,31})(\.\d{1,6})?$/.test(value)) throw new Error('Use decimals with at most six places.')
    const [whole,fraction=''] = value.split('.')
    return BigInt(whole)*1000000n + BigInt(fraction.padEnd(6,'0'))
  }
  const q=parse(quantity),p=parse(price)
  if (q<=0n || q >= (1n<<128n) || p<=0n || p>=1000000n) throw new Error('Positive quantity and price between 0 and 1 required.')
  if (q*p%1000000n) throw new Error('Fractional micro-USDC: use fewer decimal places or increase quantity.')
  const payment=q*p/1000000n
  if (!payment || payment >= (1n<<128n)) throw new Error('Invalid payment.')
  return {quantity:q.toString(),payment:payment.toString()}
}
export async function verifyConfig(c) {
  requireLocal()
  if (!c.demoOnly || c.chainId!==31337 || c.rpcUrl!=='http://127.0.0.1:8545' || c.collateralDecimals!==6 || c.domain?.name!=='KhmerFP Exchange' || c.domain.version!=='1' || c.domain.chainId!==31337 || c.domain.verifyingContract!==c.addresses.exchange) throw new Error('Unexpected demo configuration.')
  const rpc=new JsonRpcProvider(c.rpcUrl,31337,{cacheTimeout:-1})
  try {
    const meta=await rpc.send('hardhat_metadata',[])
    if (meta.instanceId!==c.instanceId || meta.forkedNetwork || (await rpc.getNetwork()).chainId!==31337n) throw new Error('Deployment changed. Restart backend and reconnect.')
    for (const key of ['exchange','collateral','ctf']) if (keccak256(await rpc.getCode(c.addresses[key]))!==c.codeHashes[key]) throw new Error('Deployment code mismatch.')
  } finally {rpc.destroy()}
}
export async function selectLocalChain(injected) {
  requireLocal()
  if (!injected) throw new Error('Connect an EIP-1193 wallet configured for local Hardhat.')
  const target = '0x7a69'
  if (BigInt(await injected.request({ method: 'eth_chainId' })) === 31337n) return
  try {
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] })
  } catch (error) {
    if (error.code !== 4902 && error.data?.originalError?.code !== 4902) throw error
    // only offer our fixed local network, never a server-supplied RPC.
    await injected.request({ method: 'wallet_addEthereumChain', params: [{
      chainId: target,
      chainName: 'Hardhat Local Demo',
      nativeCurrency: { name: 'Test ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: ['http://127.0.0.1:8545'],
    }] })
    await injected.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: target }] })
  }
  const selected = BigInt(await injected.request({ method: 'eth_chainId' }))
  if (selected !== 31337n) throw new Error(`Wallet still reports chain ${selected}. Select Hardhat Local (31337) for this site in MetaMask.`)
}
export async function checkWalletDeployment(injected, local, config) {
  const params = [`0x${config.deploymentBlock.toString(16)}`, false]
  const [expected, actual] = await Promise.all([
    local.send('eth_getBlockByNumber', params),
    injected.request({ method: 'eth_getBlockByNumber', params }),
  ])
  if (expected?.hash && actual?.hash === expected.hash) return
  // a second read helps distinguish stale numbered blocks from an unknown chain.
  let knownByHash = null
  let canonicalStateVerified = false
  let canonicalStateError = null
  if (expected?.hash) {
    try {
      const block = await injected.request({ method: 'eth_getBlockByHash', params: [expected.hash, false] })
      knownByHash = block?.hash === expected.hash && block.number === params[0]
    } catch { /* some wallets do not support this read; keep the mismatch blocking */ }
  }
  if (knownByHash) {
    try {
      // hash reads must prove canonical state, not just that an old fork is known.
      const anchor = { blockHash: expected.hash, requireCanonical: true }
      for (const key of ['exchange', 'collateral', 'ctf']) {
        const code = await injected.request({ method: 'eth_getCode', params: [config.addresses[key], anchor] })
        if (code === '0x' || keccak256(code) !== config.codeHashes[key]) throw new Error('Canonical contract code mismatch')
      }
      const registry = new Interface(['function markets(bytes32) view returns(uint256 yesTokenId,uint256 noTokenId,bool enabled,uint64 tradingCutoff)'])
      const call = { to: config.addresses.exchange, data: registry.encodeFunctionData('markets', [config.round.conditionId]) }
      const [localState, walletState] = await Promise.all([
        local.send('eth_call', [call, anchor]),
        injected.request({ method: 'eth_call', params: [call, anchor] }),
      ])
      if (localState !== walletState) throw new Error('Canonical market state mismatch')
      const market = registry.decodeFunctionResult('markets', walletState)
      if (market.yesTokenId.toString() !== config.tokens[0].tokenId || market.noTokenId.toString() !== config.tokens[1].tokenId
        || !market.enabled || market.tradingCutoff.toString() !== String(config.round.tradingCutoff)) throw new Error('Canonical market identity mismatch')
      canonicalStateVerified = true
    } catch {
      canonicalStateError = 'The wallet could not prove the current canonical contract code and registered market.'
    }
  }
  if (canonicalStateVerified) return
  const error = new Error('Wallet block data does not match the local demo. Open connection details below. Login was stopped before requesting a signature.')
  error.connectionDetails = {
    expectedRpc: 'http://127.0.0.1:8545',
    deploymentBlock: config.deploymentBlock,
    localBlockHash: expected?.hash ?? null,
    walletBlockHash: actual?.hash ?? null,
    walletRecognizesCurrentBlockByHash: knownByHash,
    canonicalStateVerified,
    canonicalStateError,
  }
  throw error
}
export async function connectWallet(injected,c) {
  if (!injected) throw new Error('Connect an EIP-1193 wallet configured for local Hardhat.')
  await verifyConfig(c)
  await injected.request({ method: 'eth_requestAccounts' })
  await selectLocalChain(injected)
  // create the ethers provider after switching so it cannot cache the previous chain.
  const provider=new BrowserProvider(injected)
  if ((await provider.getNetwork()).chainId!==31337n) throw new Error('Switch wallet to local Hardhat chain 31337.')
  for (const key of ['exchange','collateral','ctf']) if (keccak256(await provider.getCode(c.addresses[key]))!==c.codeHashes[key]) throw new Error('Wallet deployment mismatch.')
  const local = new JsonRpcProvider(c.rpcUrl, 31337, { cacheTimeout: -1 })
  try {
    await checkWalletDeployment(injected, local, c)
  } finally { local.destroy() }
  const signer=await provider.getSigner(),wallet=await signer.getAddress()
  return {provider,signer,wallet,
    exchange:new Contract(c.addresses.exchange,['function hasRole(bytes32,address) view returns(bool)','function paused() view returns(bool)','function markets(bytes32) view returns(uint256 yesTokenId,uint256 noTokenId,bool enabled,uint64 tradingCutoff)','function cancelOrder((address maker,uint256 tokenId,uint8 side,uint256 makerAmount,uint256 takerAmount,uint256 nonce,uint256 expiration))'],signer),
    collateral:new Contract(c.addresses.collateral,['function balanceOf(address) view returns(uint256)','function allowance(address,address) view returns(uint256)','function approve(address,uint256) returns(bool)'],signer),
    ctf:new Contract(c.addresses.ctf,['function balanceOf(address,uint256) view returns(uint256)','function isApprovedForAll(address,address) view returns(bool)','function setApprovalForAll(address,bool)'],signer)}
}
export async function authenticate(connection,c) {
  const proof=await api('/auth/challenge',{wallet:connection.wallet}),lines=proof.message.split('\n')
  const expiry=Number(lines[5]?.replace('Expires: ',''))
  if (lines.length!==6 || lines[0]!=='KhmerFP local demo login' || lines[1]!=='Chain: 31337' || lines[2]!==`Exchange: ${c.addresses.exchange}` || lines[3]!==`Wallet: ${connection.wallet}` || lines[4]!==`Nonce: ${proof.nonce}` || !Number.isSafeInteger(expiry) || expiry<=Date.now() || expiry>Date.now()+61000) throw new Error('Unexpected login challenge.')
  const result=await api('/auth/verify',{nonce:proof.nonce,signature:await connection.signer.signMessage(proof.message)})
  if (!result.demoOnly || result.wallet!==connection.wallet) throw new Error('Wallet authentication mismatch.')
}
export async function balances(w,c) {
  const [usdc,yes,no,allowance,approved,role,paused,market]=await Promise.all([w.collateral.balanceOf(w.wallet),...c.tokens.map(t=>w.ctf.balanceOf(w.wallet,t.tokenId)),w.collateral.allowance(w.wallet,c.addresses.exchange),w.ctf.isApprovedForAll(w.wallet,c.addresses.exchange),w.exchange.hasRole(id('OPERATOR_ROLE'),w.wallet),w.exchange.paused(),w.exchange.markets(c.round.conditionId)])
  if (market.yesTokenId.toString() !== c.tokens[0].tokenId || market.noTokenId.toString() !== c.tokens[1].tokenId || market.tradingCutoff.toString() !== String(c.round.tradingCutoff)) throw new Error('Market registry changed.')
  return {usdc,yes,no,allowance,approved,paused,enabled:market.enabled,operator:role && w.wallet===c.accounts.operator}
}
export function buildOrder(c,wallet,tokenId,side,fill,now=Date.now()) {
  if (now>=c.round.tradingCutoff*1000) throw new Error('Trading cutoff reached.')
  if (!c.tokens.some(t=>t.tokenId===tokenId) || ![0,1].includes(side)) throw new Error('Invalid outcome or side.')
  const nonce=new Uint32Array(4); crypto.getRandomValues(nonce)
  return {maker:wallet,tokenId,side,makerAmount:side===0?fill.payment:fill.quantity,takerAmount:side===0?fill.quantity:fill.payment,nonce:nonce.reduce((n,v)=>(n<<32n)+BigInt(v),0n).toString(),expiration:String(c.round.tradingCutoff)}
}
