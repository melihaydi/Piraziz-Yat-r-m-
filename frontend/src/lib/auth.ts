/**
 * Real backend-backed authentication. Previously "logged in" just meant a
 * profile object sitting in localStorage with its password in plain text,
 * checked against future login attempts client-side - it never actually
 * validated against the real user accounts already in the backend's
 * database, so an account was only ever usable from the one browser that
 * created it. login()/register() below are real calls against the bcrypt-
 * backed /auth endpoints; only the resulting JWT is kept client-side.
 */

import { API_BASE_URL as API_ORIGIN } from "./config"

export const API_BASE_URL = `${API_ORIGIN}/api/v1`

export interface AuthResult {
  ok: boolean
  error?: string
  requires2FA?: boolean
  tempToken?: string
}

/**
 * fetch() that retries on network-level failure (thrown exception, e.g.
 * "connection refused") instead of giving up immediately - the Electron
 * wrapper spawns the Python backend in the background on launch, and in dev
 * (run_dev.bat) frontend/backend start in parallel with no readiness gate,
 * so the very first request(s) after app start can race a backend that
 * isn't listening yet.
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = 3, delayMs = 1500): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, options)
    } catch (e) {
      if (attempt >= retries) throw e
      await new Promise(r => setTimeout(r, delayMs))
    }
  }
}

async function firstErrorDetail(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null)
  return (body && (body.detail as string)) || fallback
}

export async function login(email: string, password: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: email, password }),
    })
    if (!res.ok) {
      return { ok: false, error: await firstErrorDetail(res, "E-posta veya şifre hatalı.") }
    }
    const data = await res.json()
    if (data.requires_2fa) {
      // Password was correct, but the account has 2FA enabled - no token
      // yet, the caller must collect a code and call verifyTwoFactor().
      return { ok: false, requires2FA: true, tempToken: data.temp_token }
    }
    localStorage.setItem("token", data.access_token)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

/** Second step of a 2FA login - exchanges the temp_token from login() plus
 * the current authenticator code for a real session token. */
export async function verifyTwoFactor(tempToken: string, code: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/login/2fa`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ temp_token: tempToken, code }),
    })
    if (!res.ok) {
      return { ok: false, error: await firstErrorDetail(res, "Kod hatalı veya süresi dolmuş.") }
    }
    const data = await res.json()
    localStorage.setItem("token", data.access_token)
    return { ok: true }
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

export async function register(email: string, password: string, fullName: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password, full_name: fullName, terms_accepted: true }),
    })
    if (!res.ok) {
      return { ok: false, error: await firstErrorDetail(res, "Kayıt oluşturulamadı.") }
    }
    return login(email, password)
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

/** Returns the current user's profile, or null if there's no valid session. */
export async function fetchCurrentUser(): Promise<any | null> {
  const token = localStorage.getItem("token")
  if (!token) return null
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return null
    return await res.json()
  } catch (e) {
    return null
  }
}

/** Always returns ok:true with a generic message, whether or not the email
 * belongs to a real account - matches the backend's enumeration-safe
 * response (see /auth/forgot-password's docstring). */
export async function forgotPassword(email: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/forgot-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    return { ok: res.ok, error: res.ok ? undefined : await firstErrorDetail(res, "Bir hata oluştu.") }
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

export async function resetPassword(token: string, newPassword: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/reset-password`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token, new_password: newPassword }),
    })
    if (!res.ok) {
      return { ok: false, error: await firstErrorDetail(res, "Bağlantı geçersiz veya süresi dolmuş.") }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

export async function verifyEmail(token: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/verify-email`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token }),
    })
    if (!res.ok) {
      return { ok: false, error: await firstErrorDetail(res, "Doğrulama bağlantısı geçersiz veya süresi dolmuş.") }
    }
    return { ok: true }
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

export async function resendVerification(email: string): Promise<AuthResult> {
  try {
    const res = await fetchWithRetry(`${API_BASE_URL}/auth/resend-verification`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email }),
    })
    return { ok: res.ok, error: res.ok ? undefined : await firstErrorDetail(res, "Bir hata oluştu.") }
  } catch (e) {
    return { ok: false, error: "Sunucuya ulaşılamadı." }
  }
}

function decodeJwtPayload(token: string): any | null {
  try {
    const payload = token.split(".")[1]
    const json = decodeURIComponent(
      atob(payload.replace(/-/g, "+").replace(/_/g, "/"))
        .split("")
        .map(c => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
        .join("")
    )
    return JSON.parse(json)
  } catch {
    return null
  }
}

/** Per-browser profile picture storage key, scoped to the currently logged-in
 * user's id (the JWT's `sub` claim, decoded client-side - no extra request).
 * Without this, a single shared "bip_profile_pic" key meant switching
 * accounts on the same browser kept showing whichever account had uploaded a
 * photo last, until the new account overwrote it too. Returns null when
 * there's no valid session - callers should skip reading/writing any key then. */
export function getProfilePicKey(): string | null {
  const token = localStorage.getItem("token")
  if (!token) return null
  const sub = decodeJwtPayload(token)?.sub
  return sub ? `bip_profile_pic:${sub}` : null
}

/** Clears the session and notifies AuthGate to show the login screen again. */
export function logout() {
  localStorage.removeItem("token")
  // Legacy unscoped key from before profile pictures were namespaced per
  // user (see getProfilePicKey) - removed here so it can never leak into
  // whichever account logs in next on this browser.
  localStorage.removeItem("bip_profile_pic")
  window.dispatchEvent(new Event("bip:session-expired"))
}

// De-dupes concurrent refresh calls - authFetch runs every few seconds while
// polling is active (see usePolling.ts), so without this every one of those
// calls would independently notice "token is getting old" at once.
let refreshInFlight: Promise<string | null> | null = null
// Throttles how often a background refresh is even attempted. Without this,
// a deployment with a short ACCESS_TOKEN_EXPIRE_MINUTES (some environments'
// example .env sets 60 minutes, well under the 3h lookahead below) would
// have every single authFetch call - i.e. every poll tick - kick off a
// refresh, since "less than 3h remaining" would be permanently true.
let lastRefreshAttemptAt = 0
const REFRESH_COOLDOWN_MS = 5 * 60 * 1000

/** Renews the stored token in the background well before it actually
 *  expires, using POST /auth/refresh (valid while the CURRENT token still
 *  is). Previously a token was only ever replaced by a fresh login: once the
 *  24h lifetime (ACCESS_TOKEN_EXPIRE_MINUTES) ran out, the next request
 *  simply 401'd and authFetch logged the session out immediately, with no
 *  warning - reported as being logged out "randomly" even during active use.
 *  As long as the user keeps the app open/polling, this keeps sliding the
 *  expiry forward so that hard wall is never actually reached; a genuinely
 *  idle session still expires and requires a real login, same as before. */
async function maybeRefreshToken(token: string): Promise<string> {
  const payload = decodeJwtPayload(token)
  const exp = typeof payload?.exp === "number" ? payload.exp : null
  if (exp === null) return token

  const msRemaining = exp * 1000 - Date.now()
  const REFRESH_BEFORE_MS = 3 * 60 * 60 * 1000 // 3 saat kala arka planda yenile
  const MUST_AWAIT_MS = 30 * 1000 // bu kadar az kaldıysa isteği eski token'la göndermeye değmez

  if (msRemaining > REFRESH_BEFORE_MS) return token

  const imminent = msRemaining < MUST_AWAIT_MS
  if (!refreshInFlight && (imminent || Date.now() - lastRefreshAttemptAt > REFRESH_COOLDOWN_MS)) {
    lastRefreshAttemptAt = Date.now()
    refreshInFlight = fetchWithRetry(`${API_BASE_URL}/auth/refresh`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }, 1)
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!data?.access_token) return null
        localStorage.setItem("token", data.access_token)
        return data.access_token as string
      })
      .catch(() => null)
      .finally(() => { refreshInFlight = null })
  }

  if (msRemaining < MUST_AWAIT_MS) {
    return (await refreshInFlight) || token
  }
  // Süresi hâlâ rahat - yenileme arka planda sürsün, bu isteği mevcut
  // (henüz geçerli) token'la hemen gönder.
  return token
}

/**
 * fetch() wrapper against the API that attaches the stored bearer token.
 * On a 401 (expired/invalid token), logs the session out instead of
 * silently trying to re-authenticate - there's no password kept client-side
 * to do that with anymore. A 401 should now only happen for a session that
 * was truly idle for the whole token lifetime (maybeRefreshToken above
 * keeps an active session's token perpetually fresh), so re-prompting for
 * credentials at that point is expected behavior, not a bug.
 */
export async function authFetch(path: string, options: RequestInit = {}, retries = 3): Promise<Response> {
  let token = localStorage.getItem("token")
  if (token) token = await maybeRefreshToken(token)

  const doFetch = (t: string | null) =>
    fetchWithRetry(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    }, retries)

  const res = await doFetch(token)
  if (res.status === 401) {
    logout()
  }
  return res
}
