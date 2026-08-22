import { TradeProvider } from "@/contexts/TradeContext"

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeProvider>
      {/* AppChrome already skips the app's global Sidebar/Header entirely for
       * /trade routes, so this owns the full viewport directly - no padding
       * to cancel out anymore. Uses the same V2 background/foreground tokens
       * and Inter font as the rest of the app. */}
      <div className="h-full w-full overflow-y-auto bg-background text-foreground">
        {children}
      </div>
    </TradeProvider>
  )
}
