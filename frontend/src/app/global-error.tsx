"use client" // Error boundaries must be Client Components

/**
 * Last-resort boundary for errors thrown in the root layout itself, where
 * app/error.tsx can't help because the layout (and therefore the app's
 * chrome) never rendered. Must ship its own <html>/<body> for that reason,
 * and can't rely on the app's fonts/providers - hence the inline styles
 * instead of the Tailwind classes used everywhere else.
 */
export default function GlobalError({
  error,
  unstable_retry,
}: {
  error: Error & { digest?: string }
  unstable_retry: () => void
}) {
  return (
    <html lang="tr">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#101015",
          color: "#e5e5e5",
          fontFamily: "system-ui, -apple-system, sans-serif",
          padding: "1.5rem",
        }}
      >
        <div style={{ textAlign: "center", maxWidth: "28rem" }}>
          <h2 style={{ fontSize: "1.25rem", fontWeight: 800, margin: "0 0 0.5rem" }}>
            Uygulama başlatılamadı
          </h2>
          <p style={{ fontSize: "0.875rem", color: "#a1a1aa", lineHeight: 1.6, margin: "0 0 1.25rem" }}>
            Beklenmedik bir hata oluştu. Sayfayı yenilemeyi deneyin; sorun sürerse bir süre sonra
            tekrar deneyin.
          </p>
          {error.digest && (
            <p style={{ fontSize: "0.7rem", fontFamily: "monospace", color: "#71717a", margin: "0 0 1rem" }}>
              Hata kodu: {error.digest}
            </p>
          )}
          <button
            onClick={() => unstable_retry()}
            style={{
              fontSize: "0.8rem",
              fontWeight: 700,
              padding: "0.65rem 1.25rem",
              borderRadius: "0.375rem",
              border: "1px solid #3f3f46",
              background: "#7c3aed",
              color: "#fff",
              cursor: "pointer",
            }}
          >
            Tekrar Dene
          </button>
        </div>
      </body>
    </html>
  )
}
