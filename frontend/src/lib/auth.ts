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
      body: JSON.stringify({ email, password, full_name: fullName }),
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

/** Clears the session and notifies AuthGate to show the login screen again. */
export function logout() {
  localStorage.removeItem("token")
  window.dispatchEvent(new Event("bip:session-expired"))
}

/**
 * fetch() wrapper against the API that attaches the stored bearer token.
 * On a 401 (expired/invalid token), logs the session out instead of
 * silently trying to re-authenticate - there's no password kept client-side
 * to do that with anymore, and a real auth system re-prompting for
 * credentials once a day (tokens last 24h) is expected behavior, not a bug.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem("token")

  const doFetch = (t: string | null) =>
    fetchWithRetry(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    })

  const res = await doFetch(token)
  if (res.status === 401) {
    logout()
  }
  return res
}
