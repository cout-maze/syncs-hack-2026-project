/**
 * A fake JWT for the mock backend only.
 *
 * It has the same three-part shape and the same claims as the real token
 * (`sub`, `email`, `role`, `exp`) so nothing in the app can accidentally depend on mock-only
 * behaviour - but it is not signed, and it never leaves the browser.
 */

const MOCK_SIGNATURE = 'mock-signature-not-a-real-jwt';
const TWENTY_FOUR_HOURS = 24 * 60 * 60;

interface TokenClaims {
  sub: string;
  email: string;
  role: 'user' | 'admin';
  exp: number;
}

function base64UrlEncode(value: string): string {
  return btoa(unescape(encodeURIComponent(value)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function base64UrlDecode(value: string): string {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(padded)));
}

export function signMockToken(userId: string, email: string, role: 'user' | 'admin' = 'user'): string {
  const header = base64UrlEncode(JSON.stringify({ alg: 'none', typ: 'JWT' }));
  const claims: TokenClaims = {
    sub: userId,
    email,
    role,
    exp: Math.floor(Date.now() / 1000) + TWENTY_FOUR_HOURS,
  };
  return `${header}.${base64UrlEncode(JSON.stringify(claims))}.${MOCK_SIGNATURE}`;
}

export function verifyMockToken(token: string | null | undefined): TokenClaims | null {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[2] !== MOCK_SIGNATURE) return null;

  try {
    const claims = JSON.parse(base64UrlDecode(parts[1] as string)) as TokenClaims;
    if (!claims.sub || claims.exp * 1000 < Date.now()) return null;
    return claims;
  } catch {
    return null;
  }
}

/** Pull the bearer token out of a request. */
export function claimsFromRequest(request: Request): TokenClaims | null {
  const header = request.headers.get('Authorization');
  if (!header?.startsWith('Bearer ')) return null;
  return verifyMockToken(header.slice('Bearer '.length));
}
