import { useState } from 'react'
import { useAuth } from '../../auth/authContext.js'

// show the session state with a sign-in or sign-out action
export function UserMenu() {
  const { user, status, logout } = useAuth()
  const [error, setError] = useState(false)

  if (status === 'loading') {
    return <span className="text-xs text-slate-400">…</span>
  }

  if (!user) {
    return (
      <a
        href="/login"
        className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Sign in
      </a>
    )
  }

  async function handleLogout() {
    setError(false)

    try {
      await logout()
    } catch {
      setError(true)
    }
  }

  return (
    <div className="flex items-center gap-3">
      {error && (
        <span className="text-xs text-red-600">Sign-out failed. Try again.</span>
      )}

      {user.avatar_url ? (
        <img
          src={user.avatar_url}
          alt=""
          className="h-8 w-8 rounded-full border border-slate-200"
        />
      ) : (
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-emerald-100 text-xs font-semibold text-emerald-700">
          {user.display_name.slice(0, 1).toUpperCase()}
        </span>
      )}

      <span className="hidden text-sm text-slate-700 sm:inline">
        {user.display_name}
      </span>

      <a
        href="/security"
        className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Security
      </a>

      <button
        type="button"
        onClick={() => void handleLogout()}
        className="rounded-full border border-slate-300 bg-white px-4 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
      >
        Sign out
      </button>
    </div>
  )
}
