import { getAuthenticatedUser } from '../services/authSessionService.js'

// Create middleware that requires a valid session.
export function createRequireAuth(lookupUser = getAuthenticatedUser) {
  return async function requireAuth(request, response, next) {
    try {
      const user = request.authUser || await lookupUser(request)

      if (!user) {
        response.status(401).json({ message: 'Authentication required.' })
        return
      }

      request.authUser = user
      next()
    } catch (error) {
      next(error)
    }
  }
}

export const requireAuth = createRequireAuth()
