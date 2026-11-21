import React from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../state/AppContext.jsx'
import { custodialEnabled } from '../services/custodialTrading.js'
export default function CustodialHome(){const {trading}=useApp();if(!import.meta.env.DEV||!custodialEnabled)return null;return <main className="p-6"><Link to="/">Back to KhmerFP</Link><h1>Development trading diagnostics</h1><pre>{JSON.stringify({connection:trading.connection,error:trading.error,market:trading.market,book:trading.book},null,2)}</pre></main>}
