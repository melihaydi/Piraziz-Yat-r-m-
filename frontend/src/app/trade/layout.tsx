import { TradeProvider } from "@/contexts/TradeContext"

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeProvider>
      {/* AppChrome already skips the app's global Sidebar/Header entirely for
       * /trade routes, so this owns the full viewport directly - no padding
       * to cancel out anymore. Dark near-black theme (#101015) + white text,
       * same Inter font as the rest of the app - see globals.css's
       * .trade-terminal for the --trade-bg/--trade-panel tokens used
       * throughout this module's components. */}
      <div className="h-full w-full overflow-y-auto bg-[#101015] text-white trade-terminal">
        {children}
      </div>
    </TradeProvider>
  )
}
