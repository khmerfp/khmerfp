const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "connect-src 'self' https://accounts.google.com https://oauth.telegram.org https://connect.facebook.net https://graph.facebook.com https://*.facebook.com",
  "form-action 'self' https://checkout-sandbox.payway.com.kh",
  "frame-ancestors 'none'",
  "frame-src 'self' https://accounts.google.com https://oauth.telegram.org https://connect.facebook.net https://*.facebook.com",
  "img-src 'self' data: https://*.googleusercontent.com https://*.telegram.org https://*.fbcdn.net https://*.facebook.com",
  "object-src 'none'",
  "script-src 'self' https://accounts.google.com https://telegram.org https://connect.facebook.net",
  "style-src 'self' https://telegram.org",
].join('; ')

// create the security header middleware
export function createSecurityHeaders({ isProduction = false } = {}) {
  // apply safe browser policies
  return function securityHeaders(_request, response, next) {
    response.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY)
    response.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups')
    response.setHeader('Referrer-Policy', 'no-referrer')
    response.setHeader('X-Content-Type-Options', 'nosniff')
    response.setHeader('X-Frame-Options', 'DENY')
    response.setHeader(
      'Permissions-Policy',
      'camera=(), geolocation=(), microphone=(), payment=()',
    )

    if (isProduction) {
      response.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains',
      )
    }

    next()
  }
}
