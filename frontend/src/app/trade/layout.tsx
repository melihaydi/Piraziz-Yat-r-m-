import { JetBrains_Mono } from "next/font/google"
import { TradeProvider } from "@/contexts/TradeContext"

// A dedicated monospace font for the terminal's numeric displays (prices,
// P&L, balances) - scoped to this module only via the "trade-terminal"
// class (see globals.css), which remaps Tailwind's font-mono utility to
// this font for everything under it instead of changing it site-wide.
const jetbrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" })

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeProvider>
      {/* AppChrome already skips the app's global Sidebar/Header entirely for
       * /trade routes, so this owns the full viewport directly - no padding
       * to cancel out anymore. */}
      <div className={`h-full w-full overflow-y-auto bg-slate-950 text-slate-200 trade-terminal ${jetbrainsMono.variable}`}>
        {children}
      </div>
    </TradeProvider>
  )
}
