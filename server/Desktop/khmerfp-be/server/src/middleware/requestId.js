import { randomUUID } from 'node:crypto'

const REQUEST_ID_PATTERN = /^[A-Za-z0-9._-]{8,64}$/

// validate one request id
export function isValidRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_PATTERN.test(value)
}

// create the request id middleware
export function createRequestIdMiddleware(generateId = randomUUID) {
  // attach one safe request id
  return function assignRequestId(request, response, next) {
    const providedId = request.get('X-Request-ID')
    const requestId = isValidRequestId(providedId) ? providedId : generateId()

    request.requestId = requestId
    response.set('X-Request-ID', requestId)
    next()
  }
}
