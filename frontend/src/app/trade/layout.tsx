import { TradeProvider } from "@/contexts/TradeContext"

export default function TradeLayout({ children }: { children: React.ReactNode }) {
  return (
    <TradeProvider>
      {/* Negative margin cancels out the shared <main> element's p-8 padding
       * from the root layout, so the Trade terminal can use the full content
       * area edge-to-edge like a real brokerage terminal - the rest of the
       * app keeps its normal padded layout untouched. */}
      <div className="-m-8 min-h-[calc(100vh-4rem)] bg-slate-950 text-slate-200">
        {children}
      </div>
    </TradeProvider>
  )
}
