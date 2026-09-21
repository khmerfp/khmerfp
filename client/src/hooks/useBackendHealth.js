import { useEffect, useState } from 'react'
import { getBackendHealth } from '../services/api.js'

export function useBackendHealth() {
  const [health, setHealth] = useState('checking')

  useEffect(() => {
    getBackendHealth().then(setHealth)
  }, [])

  return health
}

