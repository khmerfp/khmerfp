import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { expect } from '../../../tools/wallet-browser-e2e/node_modules/@playwright/test/index.mjs'

export const screenshotDirectory=join(tmpdir(),'khmerfp-phase410-ui-comparison')
export async function publicLayout(page){
  return page.evaluate(()=>{
    const card=document.querySelector('.market-card'),title=card?.querySelector('h3'),nav=document.querySelector('nav'),header=document.querySelector('header')
    const css=element=>{const s=getComputedStyle(element);return {background:s.backgroundColor,color:s.color,radius:s.borderRadius,fontFamily:s.fontFamily,fontSize:s.fontSize}}
    return {headerHeight:header.getBoundingClientRect().height,navTop:getComputedStyle(nav).top,card:css(card),title:css(title),width:innerWidth,bodyWidth:document.body.scrollWidth}
  })
}
async function own(page,origin,path){const response=await page.request.get(origin+'/api/trading'+path);assert.equal(response.status(),200);return response.json()}
async function waitOrder(page,origin,id,status){
  let result
  await expect.poll(async()=>{result=(await own(page,origin,'/me/orders?limit=100')).orders.find(o=>o.id===String(id));return result?.command_state==='QUEUED'?'PROCESSING':result?.status},{timeout:15000}).toBe(status)
  return result
}
async function submit(page,origin){
  const response=page.waitForResponse(r=>r.url()===origin+'/api/trading/orders'&&r.request().method()==='POST')
  await page.getByRole('button',{name:'Submit order',exact:true}).click()
  const accepted=await response;assert.equal(accepted.status(),202,JSON.stringify(await accepted.clone?.json?.()))
  return accepted.json()
}
async function closeTicket(page){await page.getByRole('button',{name:'Close market',exact:true}).click()}
async function closePortfolio(panel){await panel.getByRole('button',{name:'Cancel',exact:true}).click()}
function tokenBalance(snapshot,tokenId){return snapshot.positions.find(p=>p.token_id===String(tokenId))||{posted:'0',available:'0',reserved:'0'}}
function dollars(value){const n=BigInt(value);return '$'+String(n/100n)+'.'+String(n%100n).padStart(2,'0')}
async function verifyCashPanel(page,portfolio,snapshot){
  const panel=await portfolio(page)
  for(const [label,key]of [['Total','posted'],['Available','available'],['Reserved','reserved']])await expect(panel.getByText(label,{exact:true}).locator('..')).toContainText(dollars(snapshot.cash[key]))
  await closePortfolio(panel)
}

// These are real authenticated API/browser operations on the verified disposable fixture.
export async function runMarketOrderUiCases({origin,url,browser,login,open,portfolio,scenarios,reconcile,referenceLayouts}){
  mkdirSync(screenshotDirectory,{recursive:true})
  for(const viewport of [{width:390,height:844},{width:1440,height:900}])for(const scenario of scenarios){
    const size=viewport.width===390?'mobile':'desktop',kind=scenario.market.type.toLowerCase()
    // Each case uses the real shared-IP rate limit; wait a full window, never bypass it.
    console.log('Waiting for public rate window before',size,kind);
    await new Promise(resolve=>setTimeout(resolve,61000));
    const buyer=await login(scenario.buyer,viewport),seller=await login(scenario.seller,viewport)
    try{
      const detail=(await own(buyer,origin,`/markets/${scenario.market.marketId}`)).market
      const polarity=scenario.market.type==='BINARY'?'NO':'YES'
      const claim=detail.claims.find(c=>c.outcome_index===0&&c.polarity===polarity)
      assert.ok(claim)
      const beforeBuyer=await own(buyer,origin,'/me/portfolio'),beforeSeller=await own(seller,origin,'/me/portfolio')
      const layout=await publicLayout(buyer),baseline=referenceLayouts[size]
      for(const key of ['headerHeight','navTop'])assert.equal(layout[key],baseline[key],`${size} original ${key}`)
      for(const key of ['background','color','radius'])assert.equal(layout.card[key],baseline.card[key],`${size} original card ${key}`)
      assert.equal(layout.title.fontFamily,baseline.title.fontFamily,`${size} original typography family`);
      // The subsequent approved card cleanup intentionally reduced titles to 15px.
      assert.equal(layout.title.fontSize,'15px',`${size} approved clean card typography`);
      assert.ok(layout.bodyWidth<=viewport.width)
      await buyer.screenshot({path:join(screenshotDirectory,`restored-${size}-${kind}-home-en.png`),fullPage:true})
      await open(buyer,scenario.market,polarity==='YES'?'Yes':'No')
      await open(seller,scenario.market,polarity==='YES'?'Yes':'No')
      await seller.getByRole('button',{name:'Sell',exact:true}).click()
      await seller.getByLabel('Whole shares',{exact:true}).fill('3')
      await seller.getByLabel('Limit price (cents)',{exact:true}).fill('60')
      const resting=await submit(seller,origin);await waitOrder(seller,origin,resting.orderId,'OPEN')
      await expect.poll(async()=>tokenBalance(await own(seller,origin,'/me/portfolio'),claim.token_id).reserved).toBe('3000000')
      const book=buyer.getByRole('region',{name:'Order book'})
      const bookDetails=book.locator('details').first();
      if(!await bookDetails.evaluate(e=>e.open))await bookDetails.locator(':scope > summary').click();
      await expect(book.getByRole('heading',{name:'Asks',exact:true}).locator('..')).toContainText('60 cents')
      await expect(book.getByRole('heading',{name:'Asks',exact:true}).locator('..')).toContainText('3')
      await closeTicket(seller)
      const sellerPanel=await portfolio(seller)
      const holding=sellerPanel.getByRole('button').filter({hasText:detail.title}).first()
      await expect(holding).toContainText('Reserved: 3')
      await closePortfolio(sellerPanel)
      await buyer.getByRole('button',{name:'Market',exact:true}).click()
      await buyer.getByLabel('Whole shares',{exact:true}).fill('5')
      await buyer.getByLabel('Protected price (cents)',{exact:true}).fill('65')
      await buyer.getByLabel('Maximum spend (USD cents)',{exact:true}).fill('325')
      await buyer.getByRole('button',{name:'Estimate execution',exact:true}).click()
      await expect(buyer.getByText('Estimated total',{exact:true}).locator('..')).toContainText('$1.80')
      await expect(buyer.getByText('Unfilled shares',{exact:true}).locator('..')).toContainText('2')
      await buyer.screenshot({path:join(screenshotDirectory,`restored-${size}-${kind}-detail-en.png`),fullPage:true})
      const purchase=await submit(buyer,origin),bought=await waitOrder(buyer,origin,purchase.orderId,'CANCELLED')
      assert.equal(bought.filled_quantity,'3000000');assert.equal(bought.remaining_quantity,'0')
      const afterBuy=await own(buyer,origin,'/me/portfolio'),afterSell=await own(seller,origin,'/me/portfolio')
      assert.equal(BigInt(afterBuy.cash.posted),BigInt(beforeBuyer.cash.posted)-180n);assert.equal(afterBuy.cash.reserved,'0')
      assert.equal(BigInt(tokenBalance(afterBuy,claim.token_id).posted),BigInt(tokenBalance(beforeBuyer,claim.token_id).posted)+3000000n)
      assert.equal(BigInt(afterSell.cash.posted),BigInt(beforeSeller.cash.posted)+180n)
      assert.equal(BigInt(tokenBalance(afterSell,claim.token_id).posted),BigInt(tokenBalance(beforeSeller,claim.token_id).posted)-3000000n);assert.equal(tokenBalance(afterSell,claim.token_id).reserved,'0')
      await expect(book.getByRole('heading',{name:'Asks',exact:true}).locator('..')).toContainText('No orders available.')
      await closeTicket(buyer);await verifyCashPanel(buyer,portfolio,afterBuy)
      await open(seller,scenario.market,polarity==='YES'?'Yes':'No')
      await seller.getByLabel('Whole shares',{exact:true}).fill('2');await seller.getByLabel('Limit price (cents)',{exact:true}).fill('55')
      const bid=await submit(seller,origin);await waitOrder(seller,origin,bid.orderId,'OPEN')
      const reservedCash=await own(seller,origin,'/me/portfolio');assert.equal(reservedCash.cash.reserved,'110')
      await closeTicket(seller);await verifyCashPanel(seller,portfolio,reservedCash)
      await open(buyer,scenario.market,polarity==='YES'?'Yes':'No')
      await buyer.getByRole('button',{name:'Sell',exact:true}).click();await buyer.getByRole('button',{name:'Market',exact:true}).click()
      await buyer.getByLabel('Whole shares',{exact:true}).fill('2');await buyer.getByLabel('Protected price (cents)',{exact:true}).fill('50')
      const reopenedBook=buyer.getByRole('region',{name:'Order book'}).locator('details').first();
      if(!await reopenedBook.evaluate(e=>e.open))await reopenedBook.locator(':scope > summary').click();
      await expect(buyer.getByRole('region',{name:'Order book'}).getByRole('heading',{name:'Bids',exact:true}).locator('..')).toContainText('55 cents')
      const sale=await submit(buyer,origin);await waitOrder(buyer,origin,sale.orderId,'FILLED');await waitOrder(seller,origin,bid.orderId,'FILLED')
      const finalBuyer=await own(buyer,origin,'/me/portfolio'),finalSeller=await own(seller,origin,'/me/portfolio')
      assert.equal(BigInt(finalBuyer.cash.posted),BigInt(beforeBuyer.cash.posted)-70n);assert.equal(BigInt(finalSeller.cash.posted),BigInt(beforeSeller.cash.posted)+70n)
      for(const snapshot of [finalBuyer,finalSeller]){assert.equal(snapshot.cash.reserved,'0');assert.equal(tokenBalance(snapshot,claim.token_id).reserved,'0')}
      await closeTicket(buyer);await verifyCashPanel(buyer,portfolio,finalBuyer)
      await buyer.reload();await expect(buyer.locator('header')).toContainText(dollars(finalBuyer.cash.available))
      // Reload removes the test's deterministic animation override. Restore it
      // before taking full-page screenshots and clicking cards after language changes.
      await buyer.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});
      await buyer.context().setOffline(true);await buyer.waitForTimeout(100);await buyer.context().setOffline(false)
      await buyer.getByRole('button',{name:'Switch language'}).click();await expect(buyer.locator('html')).toHaveAttribute('lang','km')
      await buyer.screenshot({path:join(screenshotDirectory,`restored-${size}-${kind}-home-km.png`),fullPage:true})
      const currentCard=buyer.locator(`.market-card[data-market-id="${scenario.market.marketId}"]`);
      // Failed reads deliberately clear the catalog. Its independent recovery
      // poll is every 10 seconds, so wait for that fresh view before starting
      // a separate click timeout. Use the normal retry action when offered.
      await expect.poll(async()=>{
        const retry=buyer.getByRole('alert').getByRole('button');
        if(await retry.isVisible())await retry.click();
        return currentCard.isVisible();
      },{timeout:20000}).toBe(true);
      await currentCard.scrollIntoViewIfNeeded();
      await currentCard.click();
      const {tradingLabels}=await import('../../../client/src/lib/tradingText.js'),km=tradingLabels('km')
      await expect(buyer.getByRole('button',{name:km.buy,exact:true})).toBeVisible();await expect(buyer.getByRole('button',{name:km.sell,exact:true})).toBeVisible()
      await buyer.screenshot({path:join(screenshotDirectory,`restored-${size}-${kind}-detail-km.png`),fullPage:true})
      await reconcile()
      console.log(JSON.stringify({browserAcceptance:`${size}-${kind}`,marketBuyFilled:'3000000',marketBuyUnfilled:'2000000',marketSellFilled:'2000000',buyerCashDeltaCents:'-70',sellerCashDeltaCents:'70',cashAndPositionReservations:'0',languages:['en','km'],reconciled:true}))
    }catch(error){await buyer.screenshot({path:join(screenshotDirectory,'failed-acceptance.png'),fullPage:true});console.error('Browser failure visible state:',(await buyer.locator('body').innerText()).slice(-5000));throw error}finally{await buyer.context().close();await seller.context().close()}
  }
  assert.ok(url&&browser)
}

export async function runRoundTransitionUi({origin,login,open,portfolio,createRecurring,reconcile}){
  await new Promise(resolve=>setTimeout(resolve,61000));
  const fixture=await createRecurring(),page=await login(fixture.buyer,{width:390,height:844})
  try{
    await open(page,fixture.first,'Yes')
    await page.getByLabel('Limit price (cents)',{exact:true}).fill('1')
    const order=await submit(page,origin);await waitOrder(page,origin,order.orderId,'OPEN')
    assert.equal((await own(page,origin,'/me/portfolio')).cash.reserved,'1')
    await expect(page.getByText('Trading is closed for this round.',{exact:true})).toBeVisible({timeout:35000})
    await expect(page.getByRole('button',{name:'Submit order',exact:true})).toBeDisabled()
    await waitOrder(page,origin,order.orderId,'EXPIRED')
    assert.equal((await own(page,origin,'/me/portfolio')).cash.reserved,'0')
    const firstId=fixture.first.marketId,secondId=fixture.second.marketId
    await page.getByText('Round history',{exact:true}).click()
    const details=page.locator('details').filter({has:page.locator('summary').filter({hasText:'Round history'})})
    await expect(details.getByRole('button').filter({hasText:'Open'})).toBeVisible({timeout:10000})
    await details.getByRole('button').filter({hasText:'Open'}).click()
    await expect(page.getByRole('button',{name:'Submit order',exact:true})).toBeEnabled()
    const rows=await own(page,origin,`/markets/${secondId}/rounds`)
    assert.equal(rows.rounds.find(r=>r.id===firstId).trading_status,'CLOSED');assert.equal(rows.rounds.find(r=>r.id===secondId).trading_status,'OPEN')
    await page.screenshot({path:join(screenshotDirectory,'restored-mobile-recurring-transition.png'),fullPage:true})
    await closeTicket(page);const panel=await portfolio(page);await panel.getByRole('tab',{name:'Order history'}).click()
    await expect(panel.getByText('Expired',{exact:true})).toBeVisible();await closePortfolio(panel)
    await reconcile();console.log(JSON.stringify({browserAcceptance:'recurring-cutoff-expiration-next-round',oldRoundStillClosed:true,newRoundOpen:true,reservedCashReleased:true,reconciled:true}))
  }finally{await page.context().close();await fixture.close()}
}
