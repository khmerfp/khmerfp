import React from 'react'
import { render, screen, fireEvent, waitFor, cleanup, act, within } from '@testing-library/react'
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import BitcoinDemo from './BitcoinDemo.jsx'
import * as demo from './demoClient.js'
vi.mock('./demoClient.js',async()=>{
  const actual=await vi.importActual('./demoClient.js')
  return {...actual,requireLocal:vi.fn(),api:vi.fn(),verifyConfig:vi.fn(),connectWallet:vi.fn(),authenticate:vi.fn(),balances:vi.fn()}
})
const config={instanceId:'one',addresses:{exchange:'exchange'},accounts:{operator:'operator'},domain:{name:'KhmerFP Exchange'},round:{roundId:'BTC-demo',question:'Will BTC close higher?',startTime:Math.floor(Date.now()/1000),tradingCutoff:Math.floor(Date.now()/1000)+300,resolutionStatus:'PENDING',openingSample:null},tokens:[{label:'YES',tokenId:'1'},{label:'NO',tokenId:'2'}]}
let listeners,wallet,funds
beforeEach(()=>{
  vi.clearAllMocks();listeners={}
  window.ethereum={on:vi.fn((name,fn)=>{listeners[name]=fn}),removeListener:vi.fn(),request:vi.fn(async({method})=>method==='eth_accounts'?['buyer']:'0x7a69')}
  const tx=()=>Promise.resolve({wait:vi.fn().mockResolvedValue({status:1})})
  wallet={wallet:'buyer',signer:{signTypedData:vi.fn().mockResolvedValue('signature')},collateral:{approve:vi.fn(tx)},ctf:{setApprovalForAll:vi.fn(tx)},exchange:{cancelOrder:vi.fn(tx)}}
  funds={usdc:100000000n,yes:20000000n,no:20000000n,allowance:10000000n,approved:true,operator:false}
  demo.connectWallet.mockResolvedValue(wallet);demo.authenticate.mockResolvedValue();demo.balances.mockImplementation(async()=>funds)
  demo.api.mockImplementation(async path=>['/config','/market'].includes(path)?config:path==='/auth/logout'?{}:[])
})
afterEach(cleanup)
async function openDemo(){render(<BitcoinDemo/>);await screen.findByText('Will BTC close higher?');fireEvent.click(screen.getByRole('button',{name:'Open Bitcoin trading ticket'}))}
async function login(){await openDemo();fireEvent.click(screen.getByText('Connect demo wallet'));await screen.findByText('buyer');await waitFor(()=>expect(screen.getByText('Sign and submit order')).not.toBeDisabled())}
describe('isolated demo screen',()=>{
  it('opens the shared market-card drawer and closes it with Escape', async () => {
    await openDemo()
    expect(screen.getByRole('dialog', { name: 'Bitcoin demo trading ticket' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Open Bitcoin trading ticket' })).toHaveClass('market-card')
    expect(screen.queryByText(/50¢/)).not.toBeInTheDocument()
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Open Bitcoin trading ticket' }))
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })
  it.each([0, 1])('keeps NO outcome separate from trade side %s', async side => {
    await login()
    fireEvent.click(screen.getByRole('button', { name: 'NO', exact: true }))
    if (side === 1) fireEvent.click(screen.getByRole('button', { name: 'SELL', exact: true }))
    fireEvent.click(screen.getByText('Sign and submit order'))
    await screen.findByText(/Signed order stored/)
    expect(wallet.signer.signTypedData.mock.calls[0][2]).toMatchObject({
      tokenId: '2', side, makerAmount: side === 0 ? '600000' : '1000000', takerAmount: side === 0 ? '1000000' : '600000',
    })
  })
  it('shows mock funds and fixtures, with no production balance calls',async()=>{
    await login();expect(screen.getByText('Mock USDC: 100.0')).toBeInTheDocument()
    expect(within(screen.getByRole('dialog')).getByText(/Not supplied/)).toBeInTheDocument()
    expect(demo.api.mock.calls.every(([path])=>!path.includes('wallet')&&!path.includes('payway'))).toBe(true)
    expect(screen.queryByText(/manual matching/)).not.toBeInTheDocument()
  })
  it('signs exact typed orders and prevents duplicate clicks',async()=>{
    await login();const button=screen.getByText('Sign and submit order');fireEvent.click(button);fireEvent.click(button)
    await screen.findByText(/Signed order stored/)
    expect(wallet.signer.signTypedData).toHaveBeenCalledTimes(1)
    const submitted=demo.api.mock.calls.filter(([path,body])=>path==='/orders' && body)
    expect(submitted).toHaveLength(1);expect(submitted[0][1].order).toMatchObject({makerAmount:'600000',takerAmount:'1000000',side:0})
  })
  it.each(['accountsChanged','chainChanged','disconnect'])('clears the demo session on %s',async(event)=>{
    await login();act(()=>listeners[event](['other']));await screen.findByText('Connect wallet')
    expect(demo.api).toHaveBeenCalledWith('/auth/logout',{})
  })
  it('reports wrong-chain and authentication errors',async()=>{
    demo.connectWallet.mockRejectedValue(new Error('Switch wallet to local Hardhat chain 31337.'))
    await openDemo();fireEvent.click(screen.getByText('Connect demo wallet'))
    await screen.findByText(/Switch wallet/);expect(demo.authenticate).not.toHaveBeenCalled()
  })
  it('can finish login after the requested switch emits chainChanged', async () => {
    demo.connectWallet.mockImplementationOnce(async () => { listeners.chainChanged('0x7a69'); return wallet })
    await login()
    expect(demo.authenticate).toHaveBeenCalledWith(wallet, config)
    expect(screen.getByText('Sign and submit order')).not.toBeDisabled()
    expect(screen.queryByText('Wallet or chain changed. Connect again.')).not.toBeInTheDocument()
  })
  it('preserves public mismatch details when a late wallet event arrives', async () => {
    demo.connectWallet.mockRejectedValueOnce(Object.assign(new Error('Wallet block mismatch'), {
      connectionDetails: { localBlockHash: 'current', walletBlockHash: 'old', walletRecognizesCurrentBlockByHash: true },
    }))
    await openDemo(); fireEvent.click(screen.getByText('Connect demo wallet'))
    await screen.findByText('Wallet block mismatch')
    act(() => listeners.accountsChanged(['other']))
    expect(screen.getByText('Wallet block mismatch')).toBeInTheDocument()
    expect(screen.getByText(/"walletRecognizesCurrentBlockByHash": true/)).toBeInTheDocument()
    expect(demo.authenticate).not.toHaveBeenCalled()
  })
  it('only exposes matching for an authenticated operator',async()=>{
    funds.operator=true;await login();expect(screen.getByText(/manual matching/)).toBeInTheDocument()
    expect(demo.api).toHaveBeenCalledWith('/operator/orders')
  })
  it('requests bounded BUY approval and explicit SELL approval',async()=>{
    await login();fireEvent.click(screen.getByText('Approve exact ticket cost'));await screen.findByText('Approval confirmed.')
    expect(wallet.collateral.approve).toHaveBeenCalledWith('exchange','600000')
    fireEvent.click(screen.getByRole('button',{name:'SELL',exact:true}));fireEvent.click(screen.getByText('Approve CTF operator'))
    await waitFor(()=>expect(wallet.ctf.setApprovalForAll).toHaveBeenCalledWith('exchange',true))
  })
  it('rejects authentication failure without showing wallet balances',async()=>{
    demo.authenticate.mockRejectedValue(new Error('Invalid login proof.'))
    await openDemo();fireEvent.click(screen.getByText('Connect demo wallet'))
    await screen.findByText('Invalid login proof.');expect(demo.balances).not.toHaveBeenCalled()
  })
  it('disables invalid amounts and paused markets',async()=>{
    await login();fireEvent.change(screen.getByLabelText('Quantity'),{target:{value:'0.000001'}})
    expect(screen.getByText('Sign and submit order')).toBeDisabled()
    fireEvent.change(screen.getByLabelText('Quantity'),{target:{value:'1'}})
    funds={...funds,paused:true};fireEvent.click(screen.getByText('Refresh chain and orders'))
    await waitFor(()=>expect(screen.getByText('Sign and submit order')).toBeDisabled())
  })
  it('clears the session if deployment verification fails before signing',async()=>{
    await login();demo.verifyConfig.mockRejectedValueOnce(new Error('Deployment changed.'))
    fireEvent.click(screen.getByText('Sign and submit order'));await screen.findByText('Connect wallet')
    expect(wallet.signer.signTypedData).not.toHaveBeenCalled()
  })
  it('keeps failed and uncertain settlements distinct from confirmed trades',async()=>{
    const buy={id:'buy',maker:'buyer',order:{side:0,tokenId:'1',makerAmount:'650000',takerAmount:'1000000',expiration:String(config.round.tradingCutoff)},remainingQuantity:'1000000',status:'OPEN'}
    const sell={...buy,id:'sell',maker:'seller',order:{...buy.order,side:1,makerAmount:'1000000',takerAmount:'600000'}}
    funds.operator=true
    demo.api.mockImplementation(async(path,body)=>{
      if(['/config','/market'].includes(path))return config
      if(path==='/operator/orders')return [buy,sell]
      if(path==='/settlements')return [{id:'s',status:'REORGED',quantity:'1000000',payment:'600000'}]
      if(path==='/matches'){expect(body).toEqual({buyId:'buy',sellId:'sell',quantity:'1000000',payment:'600000'});return {status:'SUBMITTED'}}
      return []
    })
    await login();fireEvent.change(screen.getByLabelText('BUY order'),{target:{value:'buy'}});fireEvent.change(screen.getByLabelText('SELL order'),{target:{value:'sell'}})
    fireEvent.click(screen.getByText('Simulate and settle'));await screen.findByText(/not confirmed; do not retry/)
    expect(screen.getByText(/REORGED/)).toBeInTheDocument()
    expect(screen.queryByText(/confirmed on the local chain/)).not.toBeInTheDocument()
  })
  it('refreshes real balance results after backend-confirmed fills',async()=>{
    await login();funds={...funds,usdc:99400000n,yes:21000000n}
    const original=demo.api.getMockImplementation()
    demo.api.mockImplementation(async(path,body)=>path==='/orders'?[{id:'filled',status:'FILLED',settlementStatus:'CONFIRMED',remainingQuantity:'0',order:{side:0,tokenId:'1',expiration:String(config.round.tradingCutoff)}}]:original(path,body))
    fireEvent.click(screen.getByText('Refresh chain and orders'))
    await screen.findByText('Mock USDC: 99.4');expect(screen.getByText('YES: 21.0')).toBeInTheDocument()
    expect(screen.getByText(/FILLED · CONFIRMED/)).toBeInTheDocument()
  })
  it('blocks new orders once the market cutoff has passed',async()=>{
    const closedConfig={...config,round:{...config.round,tradingCutoff:Math.floor(Date.now()/1000)-1}}
    demo.api.mockImplementation(async path=>['/config','/market'].includes(path)?closedConfig:[])
    await openDemo();fireEvent.click(screen.getByText('Connect demo wallet'))
    await screen.findByText('buyer');await screen.findByText('Trading: CLOSED')
    expect(screen.getByText('Sign and submit order')).toBeDisabled()
    expect(wallet.signer.signTypedData).not.toHaveBeenCalled()
  })
})
