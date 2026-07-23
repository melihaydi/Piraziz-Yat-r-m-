// Backend base URL - overridable at build time so a production build (e.g.
// deployed to Netlify, talking to a real server) doesn't stay hardwired to
// localhost like the desktop/Electron build is. Set NEXT_PUBLIC_API_URL in
// the deploy environment (Netlify site settings) to the real backend origin,
// e.g. "https://<vm-ip-dashed>.sslip.io".
export const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000"
