import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync,mkdirSync,writeFileSync } from 'node:fs'
import { join,resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer } from 'vite'
import { expect } from '../../../tools/wallet-browser-e2e/node_modules/@playwright/test/index.mjs'
import { publicLayout,screenshotDirectory } from './tradingUiAcceptance.js'

export const originalUiCommit='47ba278d6a3b3e7a7aef6cf663c0a157f0022dc4'
// A committed source copy under ignored cache: no checkout/reset of the shared worktree.
export async function captureOriginalUi(browser){
  const repo=resolve(import.meta.dirname,'../../..'),folder=mkdtempSync(join(repo,'node_modules/.cache/khmerfp-original-ui-'))
  const archive=execFileSync('git',['archive',originalUiCommit,'client'],{cwd:repo,maxBuffer:20000000})
  const tar=join(folder,'original.tar');writeFileSync(tar,archive);execFileSync('tar',['-xf',tar,'-C',folder])
  mkdirSync(screenshotDirectory,{recursive:true})
  const vite=await createServer({root:join(folder,'client'),configFile:join(folder,'client/vite.config.js'),envDir:tmpdir(),optimizeDeps:{include:['react','react-dom/client','react/jsx-runtime','react-router-dom','lucide-react','qrcode.react']},server:{host:'127.0.0.1',port:0,strictPort:false},define:{'import.meta.env.VITE_WALLET_LINK_ENABLED':JSON.stringify('false'),'import.meta.env.VITE_CDP_EMBEDDED_WALLET_ENABLED':JSON.stringify('false')}})
  await vite.listen();const url=`http://127.0.0.1:${vite.httpServer.address().port}`,layouts={}
  try{
    for(const viewport of [{width:1440,height:900},{width:390,height:844}]){
      const size=viewport.width===390?'mobile':'desktop',context=await browser.newContext({viewport})
      await context.route('**/*',route=>{
        const url=new URL(route.request().url())
        if(!['127.0.0.1','localhost'].includes(url.hostname))return route.abort()
        if(url.pathname.startsWith('/api/'))return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(url.pathname.endsWith('/me')?{user:null}:{})})
        return route.continue()
      })
      // Only the reference screenshot has deterministic simulated display data.
      await context.addInitScript(()=>{let value=42;Math.random=()=>{value=(value*1664525+1013904223)>>>0;return value/4294967296}})
      const page=await context.newPage();page.on('pageerror',error=>console.log('Original committed UI error:',error.message));page.on('response',r=>{if(r.status()>=400)console.log('Original committed UI HTTP',r.status(),new URL(r.url()).pathname)})
      try{
        await page.goto(url,{waitUntil:'domcontentloaded'});await expect(page.locator('.market-card').first()).toBeVisible().catch(async error=>{console.log('Original page text:',await page.locator('body').innerText());throw error})
        await page.addStyleTag({content:'*,*::before,*::after{animation:none!important;transition:none!important;scroll-behavior:auto!important}'});
        if(await page.locator('html').getAttribute('lang')!=='en')await page.getByRole('button',{name:'Switch language'}).click()
        await expect(page.locator('html')).toHaveAttribute('lang','en')
        layouts[size]=await publicLayout(page);assert.ok(layouts[size].bodyWidth<=viewport.width)
        await page.screenshot({path:join(screenshotDirectory,`original-${size}-home-en.png`),fullPage:true})
        await page.locator('.market-card').first().click();await expect(page.locator('.detail-sheet')).toBeVisible()
        await page.screenshot({path:join(screenshotDirectory,`original-${size}-detail-en.png`),fullPage:true})
        await page.locator('.detail-sheet > div').first().getByRole('button').click()
        await page.getByRole('button',{name:'Switch language'}).click();await expect(page.locator('html')).toHaveAttribute('lang','km')
        await page.screenshot({path:join(screenshotDirectory,`original-${size}-home-km.png`),fullPage:true})
        await page.locator('.market-card').first().click();await page.screenshot({path:join(screenshotDirectory,`original-${size}-detail-km.png`),fullPage:true})
      }finally{await context.close()}
    }
    writeFileSync(join(screenshotDirectory,'original-layout.json'),JSON.stringify({commit:originalUiCommit,referenceUsesCommittedSimulation:true,layouts},null,2))
    return layouts
  }finally{await vite.close()}
}
