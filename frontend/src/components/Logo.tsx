import React from "react"
import { TrendingUp } from "lucide-react"

export default function Logo() {
  return (
    <div className="flex items-center space-x-2.5">
      <div className="relative flex items-center justify-center h-9 w-9 rounded-xl bg-gradient-to-tr from-emerald-500 to-teal-400 p-0.5 shadow-md shadow-emerald-500/10">
        <div className="flex items-center justify-center h-full w-full rounded-[10px] bg-zinc-950">
          <TrendingUp className="h-5 w-5 text-emerald-400" />
        </div>
      </div>
      <div className="flex flex-col">
        <span className="font-black text-sm tracking-widest text-foreground uppercase leading-none">
          PİRAZİZ
        </span>
        <span className="text-[9px] font-bold text-emerald-400 tracking-[0.22em] uppercase leading-none mt-1">
          YATIRIM
        </span>
      </div>
    </div>
  )
}
