import { TradeProvider } from "@/contexts/TradeContext"

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeProvider>
      {/* AppChrome already skips the app's global Sidebar/Header entirely for
       * /trade routes, so this owns the full viewport directly - no padding
       * to cancel out anymore. */}
      <div className="h-full w-full overflow-y-auto bg-slate-950 text-slate-200">
        {children}
      </div>
    </TradeProvider>
  )
}
