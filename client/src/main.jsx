import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import { AuthProvider } from './auth/AuthProvider.jsx'
import './index.css'

const localDemo = import.meta.env.DEV && window.location.pathname === '/local-demo/bitcoin'
const Demo = localDemo ? React.lazy(() => import('./demo/BitcoinDemo.jsx')) : null
const coinbaseProbe = import.meta.env.DEV && window.location.pathname === '/local-demo/coinbase'
// load the probe source only in development.
const CoinbaseProbe = coinbaseProbe
  ? React.lazy(() => {
      const source = '/src/demo/CoinbaseWalletProbe.jsx'
      return import(/* @vite-ignore */ source)
    })
  : null

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    {coinbaseProbe ? (
      <React.Suspense fallback={<p>Loading wallet compatibility probe...</p>}>
        <CoinbaseProbe />
      </React.Suspense>
    ) : localDemo ? (
      <React.Suspense fallback={<p>Loading local demo...</p>}>
        <Demo />
      </React.Suspense>
    ) : (
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    )}
  </React.StrictMode>,
)
