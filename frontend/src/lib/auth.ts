/**
 * Shared auth-bootstrap helper, extracted from the pattern already used in
 * app/page.tsx (portfolio signals fetch). AuthGate guarantees a valid
 * "token" exists in localStorage by the time any page renders, but tokens
 * can still expire mid-session - this re-authenticates transparently using
 * the same locally-stored credentials AuthGate itself saved at login/register
 * time, instead of every new module (like Trade) re-implementing the same
 * register+login+retry dance inline.
 */

import { API_BASE_URL as API_ORIGIN } from "./config"

export const API_BASE_URL = `${API_ORIGIN}/api/v1`

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

export async function authenticate(): Promise<string | null> {
  const userEmail = localStorage.getItem("bip_user_email") || ""
  const userPass = localStorage.getItem("bip_user_password") || ""
  const userName = localStorage.getItem("bip_username") || ""

  if (!userEmail || !userPass) return null

  try {
    // Fine if this fails because the account already exists.
    await fetchWithRetry(`${API_BASE_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: userEmail, password: userPass, full_name: userName }),
    })

    const loginRes = await fetchWithRetry(`${API_BASE_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ username: userEmail, password: userPass }),
    })
    if (!loginRes.ok) return null
    const loginData = await loginRes.json()
    if (loginData.access_token) {
      localStorage.setItem("token", loginData.access_token)
      return loginData.access_token as string
    }
  } catch (e) {
    console.error("Auth bootstrapping failed:", e)
  }
  return null
}

/**
 * fetch() wrapper against the API that attaches the stored bearer token and
 * transparently re-authenticates once on a 401 before giving up.
 */
export async function authFetch(path: string, options: RequestInit = {}): Promise<Response> {
  let token = localStorage.getItem("token")
  if (!token) {
    token = await authenticate()
  }

  const doFetch = (t: string | null) =>
    fetchWithRetry(`${API_BASE_URL}${path}`, {
      ...options,
      headers: {
        ...(options.headers || {}),
        ...(t ? { Authorization: `Bearer ${t}` } : {}),
      },
    })

  let res = await doFetch(token)
  if (res.status === 401) {
    localStorage.removeItem("token")
    const freshToken = await authenticate()
    if (freshToken) {
      res = await doFetch(freshToken)
    }
  }
  return res
}
