// isolated SDK simulation loaded only by the guarded disposable browser server.
import React, { createContext, useContext, useState } from 'react'
const Context = createContext(null)
let current = null
export function CDPReactProvider({ children }) {
  const [user, setUser] = useState(() => JSON.parse(sessionStorage.getItem('isolated-cdp-user') || 'null'))
  current = user
  function change(next) { current = next; setUser(next); if (next) sessionStorage.setItem('isolated-cdp-user', JSON.stringify(next)); else sessionStorage.removeItem('isolated-cdp-user') }
  return <Context.Provider value={{ user, change }}>{children}</Context.Provider>
}
export function useCurrentUser() { return { currentUser: useContext(Context).user } }
export function useIsInitialized() { return { isInitialized: true } }
export function useSignOut() { const { change } = useContext(Context); return { signOut: async () => change(null) } }
export async function getCurrentUser() { return current }
export function AuthButton() {
  const { change } = useContext(Context)
  return <button onClick={async () => {
    const r = await fetch('/__test/embedded-account', { headers: { 'X-Wallet-Test-Token': window.__WALLET_E2E_TOKEN } })
    if (!r.ok) throw new Error('Isolated account unavailable')
    change(await r.json())
  }}>Simulate CDP email verification</button>
}
export function useSignEvmTypedData() {
  return { signEvmTypedData: async ({ typedData }) => {
    const response = await fetch('/__test/sign', { method: 'POST', credentials: 'include', headers: {
      'Content-Type': 'application/json', 'X-Wallet-Test-Token': window.__WALLET_E2E_TOKEN,
    }, body: JSON.stringify({ challengeId: typedData.message.challengeId, scenario: 'success' }) })
    if (!response.ok) throw new Error('Isolated signing failed')
    return response.json()
  } }
}
