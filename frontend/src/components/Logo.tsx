import React from "react"

export default function Logo() {
  return (
    <div className="flex items-center space-x-2.5">
      <div className="relative h-9 w-9 rounded-xl overflow-hidden shrink-0">
        <img src="/logo.png" alt="Piraziz Yatırım" className="h-full w-full object-cover" />
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
