import React, { useEffect, useRef, useState } from 'react'
import PriceChart from '../components/PriceChart.jsx'
import { X } from 'lucide-react'
import { BinaryOutcomeButtons } from '../components/MarketTradingViews.jsx'
import DemoBitcoinCard from './DemoBitcoinCard.jsx'
import { api, amounts, authenticate, balances, buildOrder, connectWallet, display, fingerprint, orderTypes, requireLocal, verifyConfig } from './demoClient.js'

const card='rounded-xl border border-[#E4E7EC] dark:border-[#212832] bg-white dark:bg-[#12171F] p-4 space-y-3 text-sm'
const input='rounded-md border border-[#E4E7EC] dark:border-[#212832] bg-[#F4F6F8] dark:bg-[#0A0E14] p-2 w-full font-mono text-sm'
const button='rounded-lg bg-[#33C7A6] text-[#0A0E14] font-semibold px-4 py-2 text-sm disabled:opacity-40'
export default function BitcoinDemo() {
  const [config,setConfig]=useState(null),[wallet,setWallet]=useState(null),[funds,setFunds]=useState(null)
  const [orders,setOrders]=useState([]),[allOrders,setAllOrders]=useState([]),[settlements,setSettlements]=useState([])
  const [side,setSide]=useState(0),[outcome,setOutcome]=useState(0),[quantity,setQuantity]=useState('1'),[price,setPrice]=useState('0.60')
  const [buyId,setBuyId]=useState(''),[sellId,setSellId]=useState(''),[matchQty,setMatchQty]=useState('1'),[matchPrice,setMatchPrice]=useState('0.60')
  const [busy,setBusy]=useState(false),[message,setMessage]=useState(''),[now,setNow]=useState(Date.now())
  const [ticketOpen,setTicketOpen]=useState(false)
  const [connectionDetails,setConnectionDetails]=useState(null)
  const locked=useRef(false),generation=useRef(0),current=useRef(null),dialog=useRef(null)
  function clearSession() {
    generation.current++; current.current=null
    setWallet(null);setFunds(null);setOrders([]);setAllOrders([]);setSettlements([])
    void api('/auth/logout',{}).catch(()=>{})
  }
  async function run(action) {
    if (locked.current) return
    locked.current=true;setBusy(true);setMessage('');setConnectionDetails(null)
    try {await action()} catch(error) {setMessage(error.shortMessage || error.message);setConnectionDetails(error.connectionDetails ?? null)} finally {locked.current=false;setBusy(false)}
  }
  async function refresh(w=wallet,c=config,epoch=generation.current) {
    const fresh=await api('/market')
    if (fingerprint(fresh)!==fingerprint(c)) throw new Error('Deployment changed. Disconnect and reconnect.')
    await verifyConfig(fresh)
    const [nextFunds,nextOrders]=await Promise.all([balances(w,c),api('/orders')])
    let nextAll=[],nextSettlements=[]
    if (nextFunds.operator) [nextAll,nextSettlements]=await Promise.all([api('/operator/orders'),api('/settlements')])
    if (epoch!==generation.current) return
    setFunds(nextFunds);setOrders(nextOrders);setAllOrders(nextAll);setSettlements(nextSettlements);setConfig(fresh)
  }
  useEffect(()=>{
    const wasDark = document.documentElement.classList.contains('dark')
    document.documentElement.classList.add('dark')
    return () => document.documentElement.classList.toggle('dark', wasDark)
  },[])
  useEffect(()=>{
    if (!ticketOpen) return
    const previousFocus = document.activeElement
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    dialog.current?.querySelector('button')?.focus()
    const close = event => {
      if (event.key === 'Escape') setTicketOpen(false)
      if (event.key !== 'Tab') return
      const controls = [...dialog.current.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), a[href]')]
      const first = controls[0], last = controls.at(-1)
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus() }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus() }
    }
    window.addEventListener('keydown', close)
    return () => { window.removeEventListener('keydown', close); document.body.style.overflow = previousOverflow; previousFocus?.focus() }
  },[ticketOpen])
  useEffect(()=>{
    let active=true
    Promise.resolve().then(requireLocal).then(()=>api('/config')).then(async c=>{await verifyConfig(c);if(active)setConfig(c)}).catch(e=>{if(active)setMessage(e.message)})
    const timer=setInterval(()=>setNow(Date.now()),1000)
    return ()=>{active=false;clearInterval(timer)}
  },[])
  useEffect(()=>{
    const provider=window.ethereum
    const changed=()=>{
      const hadSession = Boolean(current.current)
      clearSession()
      // keep the useful failure visible when an extension emits a late event.
      setMessage(previous => hadSession ? 'Wallet or chain changed. Connect again.' : previous || 'Wallet or chain changed. Connect again.')
    }
    for (const event of ['accountsChanged','chainChanged','disconnect']) provider?.on?.(event,changed)
    return ()=>{for(const event of ['accountsChanged','chainChanged','disconnect']) provider?.removeListener?.(event,changed)}
  },[])
  useEffect(()=>{
    if (!wallet) return
    const timer=setInterval(()=>{
      if (locked.current) return
      void run(async()=>{try {await refresh()} catch(e){clearSession();throw e}})
    },10000)
    return ()=>clearInterval(timer)
  },[wallet,config])
  async function connect() {
    await api('/auth/logout',{})
    const c=await api('/config'),w=await connectWallet(window.ethereum,c)
    // switching networks emits chainChanged; begin login after that switch completes.
    const epoch=++generation.current
    await authenticate(w,c)
    if(epoch!==generation.current) {await api('/auth/logout',{});return}
    current.current=w;setWallet(w);setConfig(c)
    try { await refresh(w,c,epoch) } catch (error) { clearSession(); throw error }
    if (epoch === generation.current) setMessage('')
  }
  // check the selected account again before every signature or transfer.
  async function checked() {
    if(!wallet || current.current!==wallet) throw new Error('Connect your wallet first.')
    const accounts=await window.ethereum.request({method:'eth_accounts'})
    const chain=await window.ethereum.request({method:'eth_chainId'})
    if(accounts[0]?.toLowerCase()!==wallet.wallet.toLowerCase() || BigInt(chain)!==31337n) {clearSession();throw new Error('Wallet changed. Reconnect.')}
    const c=await api('/config')
    if(fingerprint(c)!==fingerprint(config)) {clearSession();throw new Error('Deployment changed. Reconnect.')}
    try { await verifyConfig(c) } catch (error) { clearSession(); throw error }
    return generation.current
  }
  let estimate=null
  try {estimate=amounts(quantity,price)} catch { /* show the validation error on submit */ }
  const closed=!config || now>=config.round.tradingCutoff*1000 || funds?.paused || funds?.enabled===false
  const ready=wallet && funds && estimate && !closed && (side===0 ? funds.allowance>=BigInt(estimate.payment) && funds.usdc>=BigInt(estimate.payment) : funds.approved && (outcome===0?funds.yes:funds.no)>=BigInt(estimate.quantity))
  const outstanding=allOrders.filter(o=>BigInt(o.remainingQuantity)>0n && !['CANCELLED','FILLED'].includes(o.status) && BigInt(o.order.expiration)*1000n>BigInt(now))
  const selectedBuy=outstanding.find(o=>o.id===buyId)
  const sells=outstanding.filter(o=>o.order.side===1 && (!selectedBuy || (o.order.tokenId===selectedBuy.order.tokenId && o.maker!==selectedBuy.maker && BigInt(selectedBuy.order.makerAmount)*BigInt(o.order.makerAmount)>=BigInt(o.order.takerAmount)*BigInt(selectedBuy.order.takerAmount))))
  return <main className="min-h-screen bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF]"><div className="max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-5">
    <header className="flex flex-wrap justify-between gap-3 border-b border-[#E4E7EC] dark:border-[#212832] pb-5"><div><a href="/" className="font-display-en text-2xl font-bold">KhmerFP</a><p className="text-[#F7931A] text-xs uppercase tracking-widest font-semibold mt-2">LOCAL DEMO — Mock Funds</p><p className="text-xs text-[#5B6472] dark:text-[#7C8697] mt-1">No real BTC, USDC, ABA or Bakong balances.</p></div>
      <div>{wallet?<><p className="break-all">{wallet.wallet}</p><button className={button} disabled={busy} onClick={clearSession}>Disconnect demo session</button></>:<button className={button} disabled={busy} onClick={()=>run(connect)}>Connect wallet</button>}</div></header>
    {message && !ticketOpen && <p role="status" className="rounded border border-amber-500 p-3 break-words">{message}</p>}
    {connectionDetails && !ticketOpen && <details className={card} open><summary>Wallet connection details (public block data)</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(connectionDetails,null,2)}</pre><p>These reads do not request signatures or funds. A different account or a fresh round will not resolve different block hashes.</p></details>}
    {!config && <p>Start the local chain, run demo setup, and start the demo API on port 4001.</p>}
    {config && <>
      <div><h1 className="font-display-en text-xl font-semibold mb-4">Bitcoin markets</h1><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3"><DemoBitcoinCard config={config} closed={closed} now={now} onOpen={()=>setTicketOpen(true)} /></div></div>
      {ticketOpen && <div className="fixed inset-0 z-50 flex items-end md:items-stretch md:justify-end bg-black/50 backdrop-blur-sm" onClick={e=>{if(e.target===e.currentTarget)setTicketOpen(false)}}>
      <aside ref={dialog} role="dialog" aria-modal="true" aria-label="Bitcoin demo trading ticket" className="w-full md:max-w-md max-h-[92vh] md:max-h-full md:h-full detail-sheet md:rounded-none bg-white dark:bg-[#0F141B] border-t md:border-l md:border-t-0 border-[#E4E7EC] dark:border-[#212832] overflow-y-auto slide-in">
      <div className="p-4 border-b border-[#E4E7EC] dark:border-[#212832] flex items-center justify-between sticky top-0 bg-white/95 dark:bg-[#0F141B]/95 backdrop-blur z-10"><span className="text-[10px] uppercase tracking-[0.12em] text-[#F7931A]">Crypto · Local demo · Mock funds</span><button aria-label="Close trading ticket" onClick={()=>setTicketOpen(false)}><X className="w-5 h-5" /></button></div>
      <div className="p-4 space-y-4">
      {message && <p role="status" className="rounded-lg border border-[#F7931A]/40 bg-[#F7931A]/5 p-3 text-xs break-words">{message}</p>}
      {connectionDetails && <details className={card} open><summary>Wallet connection details (public block data)</summary><pre className="whitespace-pre-wrap break-all text-xs">{JSON.stringify(connectionDetails,null,2)}</pre></details>}
      {!wallet && <button className={`${button} w-full`} disabled={busy} onClick={()=>run(connect)}>Connect demo wallet</button>}
      <section className="rounded-xl border border-[#F7931A]/30 bg-[#F7931A]/5 p-3 space-y-2 text-xs">
      <h2 className="text-xl">{config.round.question}</h2><p>{config.round.roundId}</p>
      <p>Opening BTC fixture: {config.round.openingSample ? `$${display(config.round.openingSample.priceUsd6)}`:'Not supplied — resolution pending'}</p>
      <p>Local test fixtures only. This is not a live BTC price feed.</p><PriceChart series={[]} />
      <p>Start: {new Date(config.round.startTime*1000).toLocaleTimeString()}</p><p>Cutoff: {new Date(config.round.tradingCutoff*1000).toLocaleTimeString()}</p>
      <p>Trading: {closed?'CLOSED':`${Math.max(0,Math.ceil((config.round.tradingCutoff*1000-now)/1000))} seconds remaining`}</p><p>Resolution: {config.round.resolutionStatus}</p>
      <p>YES: closing price &gt; opening price. NO: closing price ≤ opening price.</p>
      <div className="flex gap-5"><span>Mock USDC: {funds?display(funds.usdc):'—'}</span><span>YES: {funds?display(funds.yes):'—'}</span><span>NO: {funds?display(funds.no):'—'}</span></div>
    </section><section className={card}><h2 className="text-xl">Trading ticket</h2>
      <div role="group" aria-label="Trade side" className="grid grid-cols-2 gap-1.5">{['BUY','SELL'].map((label,index)=><button key={label} aria-pressed={side===index} className={`py-2 rounded-lg text-sm font-semibold border ${side===index?'bg-[#6C8EF5]/10 border-[#6C8EF5] text-[#6C8EF5]':'border-[#E4E7EC] dark:border-[#212832] text-[#5B6472] dark:text-[#7C8697]'}`} onClick={()=>setSide(index)}>{label}</button>)}</div>
      <BinaryOutcomeButtons selected={outcome===0?'yes':'no'} onSelect={value=>setOutcome(value==='yes'?0:1)} />
      <label>Quantity<input aria-label="Quantity" className={input} value={quantity} onChange={e=>setQuantity(e.target.value)} inputMode="decimal" /></label>
      <label>Price limit (mock USDC per share)<input aria-label="Price limit" className={input} value={price} onChange={e=>setPrice(e.target.value)} inputMode="decimal" /></label>
      <p>{side===0?'Maximum cost':'Minimum proceeds'}: {estimate?display(estimate.payment):'Invalid amount'} mock USDC</p>
      <p>Six decimals. No fees. Approval is a separate wallet transaction.</p>
      {side===1 && <p className="text-amber-300">ERC-1155 approval lets this exchange transfer all your CTF positions. Use only these local test accounts; you can revoke below.</p>}
      <button className={button} disabled={busy || !wallet || !estimate || closed} onClick={()=>run(async()=>{const epoch=await checked();const fill=amounts(quantity,price);const tx=side===0?await wallet.collateral.approve(config.addresses.exchange,fill.payment):await wallet.ctf.setApprovalForAll(config.addresses.exchange,true);await tx.wait();if(epoch===generation.current){await refresh();setMessage('Approval confirmed.')}})}>Approve {side===0?'exact ticket cost':'CTF operator'}</button>{' '}
      <button className={button} disabled={busy || !ready} onClick={()=>run(async()=>{
        const epoch=await checked(),fill=amounts(quantity,price),order=buildOrder(config,wallet.wallet,config.tokens[outcome].tokenId,side,fill)
        const signature=await wallet.signer.signTypedData(config.domain,orderTypes,order)
        if(epoch!==generation.current) throw new Error('Wallet changed during signing.')
        await checked()
        await api('/orders',{marketId:config.round.roundId,domain:config.domain,order,signature});await refresh();setMessage('Signed order stored — awaiting manual match.')
      })}>Sign and submit order</button>{' '}
      <button className={button} disabled={busy || !wallet} onClick={()=>run(async()=>{await checked();await (await wallet.ctf.setApprovalForAll(config.addresses.exchange,false)).wait();await refresh()})}>Revoke CTF approval</button>
    </section></div></aside></div>}</>}
    {wallet && <section className={card}><h2 className="text-xl">Your orders</h2><button className={button} disabled={busy} onClick={()=>run(()=>refresh())}>Refresh chain and orders</button>
      {orders.map(o=><div key={o.id} className="border-t border-slate-700 pt-2 break-all"><p>{o.order.side===0?'BUY':'SELL'} {config.tokens.find(t=>t.tokenId===o.order.tokenId)?.label} · {o.id}</p><p>Remaining: {display(o.remainingQuantity)} · {o.status} · {o.settlementStatus || (BigInt(o.order.expiration)*1000n<=BigInt(now)?'EXPIRED':'Awaiting match')}</p>{o.transactionHash && <p>Transaction: {o.transactionHash}</p>}{!['FILLED','CANCELLED'].includes(o.status) && <button className={button} disabled={busy} onClick={()=>run(async()=>{await checked();await (await wallet.exchange.cancelOrder(o.order)).wait();await refresh()})}>Cancel on chain</button>}</div>)}
      {!orders.length && <p>No orders submitted by this wallet.</p>}
    </section>}
    {funds?.operator && <section className={card}><h2 className="text-xl">Local demo operator · manual matching</h2><p>Select stored orders. The backend simulates and signs settlement; no operator key reaches this page.</p>
      <label>BUY order<select aria-label="BUY order" className={input} value={buyId} onChange={e=>{setBuyId(e.target.value);setSellId('')}}><option value="">Select BUY</option>{outstanding.filter(o=>o.order.side===0).map(o=><option key={o.id} value={o.id}>{o.id} · {display(o.remainingQuantity)}</option>)}</select></label>
      <label>SELL order<select aria-label="SELL order" className={input} value={sellId} onChange={e=>setSellId(e.target.value)}><option value="">Select compatible SELL</option>{sells.map(o=><option key={o.id} value={o.id}>{o.id} · {display(o.remainingQuantity)}</option>)}</select></label>
      <label>Fill quantity<input className={input} value={matchQty} onChange={e=>setMatchQty(e.target.value)} /></label><label>Execution price<input className={input} value={matchPrice} onChange={e=>setMatchPrice(e.target.value)} /></label>
      <button className={button} disabled={busy || closed || !buyId || !sellId} onClick={()=>run(async()=>{await checked();const fill=amounts(matchQty,matchPrice);const result=await api('/matches',{buyId,sellId,...fill});await refresh();setMessage(`Settlement ${result.status}${result.status==='CONFIRMED'?' — confirmed on the local chain.':' — not confirmed; do not retry uncertain submissions.'}`)})}>Simulate and settle</button>
      {settlements.map(s=><p className="break-all" key={s.id}>{s.status} · {s.hash || 'No confirmed transaction hash'} · {display(s.quantity)} shares / {display(s.payment)} mock USDC</p>)}
    </section>}
  </div></main>
}
