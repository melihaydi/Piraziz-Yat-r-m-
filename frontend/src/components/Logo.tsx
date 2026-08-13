import React from "react"

export default function Logo() {
  return (
    <div className="flex items-center space-x-2.5">
      <div className="relative h-9 w-9 rounded-xl overflow-hidden shrink-0">
        <img src="/logo.png" alt="BIP Terminal" className="h-full w-full object-cover" />
      </div>
      <div className="flex flex-col">
        <span className="font-black text-sm tracking-widest text-foreground uppercase leading-none">
          BIP
        </span>
        <span className="text-[9px] font-bold text-emerald-400 tracking-[0.22em] uppercase leading-none mt-1">
          TERMINAL
        </span>
      </div>
    </div>
  )
}
