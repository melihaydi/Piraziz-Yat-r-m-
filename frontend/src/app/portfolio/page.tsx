"use client"

import React, { useState, useEffect } from "react"
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip 
} from "recharts"
import { 
  Plus, 
  Bell, 
  TrendingUp, 
  Briefcase, 
  Trash2, 
  ToggleLeft, 
  ToggleRight,
  PieChart as PieIcon,
  Activity,
  Loader2
} from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"
import { 
  Dialog, 
  DialogContent, 
  DialogHeader, 
  DialogTitle, 
  DialogDescription, 
  DialogFooter,
  DialogTrigger 
} from "@/components/ui/Dialog"

const COLORS = ["#a855f7", "#06b6d4", "#10b981", "#fbbf24", "#ec4899", "#f97316"]

export default function PortfolioPage() {
  const [portfolios, setPortfolios] = useState<any[]>([])
  const [alerts, setAlerts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  
  // Modal states
  const [isOpenAlertModal, setIsOpenAlertModal] = useState(false)
  const [isOpenAssetModal, setIsOpenAssetModal] = useState(false)
  const [isOpenEditModal, setIsOpenEditModal] = useState(false)
  const [isOpenSellModal, setIsOpenSellModal] = useState(false)
  const [selectedAsset, setSelectedAsset] = useState<any>(null)

  // New Alert state
  const [alertTicker, setAlertTicker] = useState("")
  const [alertType, setAlertType] = useState("price")
  const [alertCondition, setAlertCondition] = useState("")

  // New Asset state
  const [assetTicker, setAssetTicker] = useState("")
  const [assetShares, setAssetShares] = useState("")
  const [assetCost, setAssetCost] = useState("")

  // Edit/Sell states
  const [editShares, setEditShares] = useState("")
  const [editCost, setEditCost] = useState("")
  const [sellShares, setSellShares] = useState("")

  // Get Auth headers helper
  const getHeaders = () => {
    const token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    return {
      "Content-Type": "application/json",
      ...(token ? { "Authorization": `Bearer ${token}` } : {})
    }
  }

  // Load portfolios and alerts
  const loadData = async () => {
    // 0. Auto login/register mock user if token not present
    let token = typeof window !== "undefined" ? localStorage.getItem("token") : null
    if (!token) {
      try {
        // Try logging in
        const loginRes = await fetch("http://localhost:8000/api/v1/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            username: "omerfaruk@bip.com",
            password: "omerfaruk123"
          })
        })
        if (loginRes.ok) {
          const loginData = await loginRes.json()
          localStorage.setItem("token", loginData.access_token)
        } else {
          // Register first
          const regRes = await fetch("http://localhost:8000/api/v1/auth/register", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: "omerfaruk@bip.com",
              password: "omerfaruk123",
              full_name: "Ömer Faruk",
              role: "premium"
            })
          })
          if (regRes.ok) {
            // Login now
            const loginRes2 = await fetch("http://localhost:8000/api/v1/auth/login", {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                username: "omerfaruk@bip.com",
                password: "omerfaruk123"
              })
            })
            if (loginRes2.ok) {
              const loginData2 = await loginRes2.json()
              localStorage.setItem("token", loginData2.access_token)
            }
          }
        }
      } catch (err) {
        console.error("Auto registration/login failed:", err)
      }
    }

    try {
      // 1. Fetch portfolios
      const portRes = await fetch("http://localhost:8000/api/v1/portfolio/", {
        headers: getHeaders()
      })
      if (portRes.ok) {
        const portData = await portRes.json()
        setPortfolios(portData)
        
        // Auto-create a default portfolio if user has none
        if (portData.length === 0) {
          const createRes = await fetch("http://localhost:8000/api/v1/portfolio/", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ name: "Ana Portföyüm" })
          })
          if (createRes.ok) {
            const newPort = await createRes.json()
            setPortfolios([newPort])
          }
        }
      }

      // 2. Fetch alerts
      const alertRes = await fetch("http://localhost:8000/api/v1/alert/", {
        headers: getHeaders()
      })
      if (alertRes.ok) {
        const alertData = await alertRes.json()
        setAlerts(alertData)
      }
    } catch (err) {
      console.error("Failed to load portfolio/alert data:", err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadData()
  }, [])

  // Derive active portfolio (default to first one)
  const activePortfolio = portfolios[0] || null

  // Calculate stats
  const assetsList = activePortfolio ? activePortfolio.assets || [] : []
  const totalCost = activePortfolio ? activePortfolio.total_cost || 0.0 : 0.0
  const currentValue = activePortfolio ? activePortfolio.total_value || 0.0 : 0.0
  const totalProfit = activePortfolio ? activePortfolio.total_profit || 0.0 : 0.0
  const profitPercentage = activePortfolio ? activePortfolio.profit_percentage || 0.0 : 0.0

  // Sector distribution for PieChart
  const pieData = assetsList.map((item: any, index: number) => ({
    name: item.ticker,
    value: Math.round(item.total_value || 0),
    color: COLORS[index % COLORS.length]
  }))

  // Add Asset Handler
  const handleAddAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!activePortfolio || !assetTicker || !assetShares || !assetCost) return

    try {
      const res = await fetch(`http://localhost:8000/api/v1/portfolio/${activePortfolio.id}/assets`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          ticker: assetTicker.toUpperCase(),
          shares: parseFloat(assetShares),
          average_cost: parseFloat(assetCost)
        })
      })
      if (res.ok) {
        setAssetTicker("")
        setAssetShares("")
        setAssetCost("")
        setIsOpenAssetModal(false)
        loadData() // Refresh
      }
    } catch (err) {
      console.error("Failed to add asset:", err)
    }
  }

  // Delete Asset Handler
  const handleDeleteAsset = async (assetId: number) => {
    try {
      const res = await fetch(`http://localhost:8000/api/v1/portfolio/assets/${assetId}`, {
        method: "DELETE",
        headers: getHeaders()
      })
      if (res.ok) {
        loadData()
      }
    } catch (err) {
      console.error("Failed to delete asset:", err)
    }
  }

  // Edit Asset Handler
  const handleEditAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAsset || !editShares || !editCost) return

    try {
      const res = await fetch(`http://localhost:8000/api/v1/portfolio/assets/${selectedAsset.id}`, {
        method: "PUT",
        headers: getHeaders(),
        body: JSON.stringify({
          shares: parseFloat(editShares),
          average_cost: parseFloat(editCost)
        })
      })
      if (res.ok) {
        setIsOpenEditModal(false)
        setSelectedAsset(null)
        loadData()
      }
    } catch (err) {
      console.error("Failed to edit asset:", err)
    }
  }

  // Sell Asset Handler
  const handleSellAsset = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!selectedAsset || !sellShares) return

    try {
      const res = await fetch(`http://localhost:8000/api/v1/portfolio/assets/${selectedAsset.id}/sell`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          shares: parseFloat(sellShares)
        })
      })
      if (res.ok) {
        setIsOpenSellModal(false)
        setSelectedAsset(null)
        setSellShares("")
        loadData()
      }
    } catch (err) {
      console.error("Failed to sell asset:", err)
    }
  }

  // Add Alert Handler
  const handleAddAlert = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!alertTicker || !alertCondition) return

    // Parse UI string (e.g. "> 310") into structured Dict for backend
    const match = alertCondition.trim().match(/^([><=]+)\s*([\d.]+)/)
    const operator = match ? match[1] : ">"
    const value = match ? parseFloat(match[2]) : parseFloat(alertCondition) || 0.0

    try {
      const res = await fetch("http://localhost:8000/api/v1/alert/", {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          ticker: alertTicker.toUpperCase(),
          alert_type: alertType,
          trigger_condition: { operator, value }
        })
      })
      if (res.ok) {
        setAlertTicker("")
        setAlertCondition("")
        setIsOpenAlertModal(false)
        loadData()
      }
    } catch (err) {
      console.error("Failed to create alert:", err)
    }
  }

  // Toggle Alert Status Handler
  const handleToggleAlert = async (id: number) => {
    try {
      const res = await fetch(`http://localhost:8000/api/v1/alert/${id}/toggle`, {
        method: "POST",
        headers: getHeaders()
      })
      if (res.ok) {
        loadData()
      }
    } catch (err) {
      console.error("Failed to toggle alert:", err)
    }
  }

  // Delete Alert Handler
  const handleDeleteAlert = async (id: number) => {
    try {
      const res = await fetch(`http://localhost:8000/api/v1/alert/${id}`, {
        method: "DELETE",
        headers: getHeaders()
      })
      if (res.ok) {
        loadData()
      }
    } catch (err) {
      console.error("Failed to delete alert:", err)
    }
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-48 space-y-4">
        <Loader2 className="h-10 w-10 text-primary animate-spin" />
        <span className="text-sm text-muted-foreground font-semibold">Portföy Canlı Verileri Derleniyor...</span>
      </div>
    )
  }

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Portföy ve Alarm Sistemi</h1>
          <p className="text-muted-foreground mt-1">Maliyet hesaplaması, sektör dağılımları ve TradingView tetikleyici alarmlar.</p>
        </div>
        <div className="flex space-x-3">
          {/* Create Alarm Dialog */}
          <Dialog open={isOpenAlertModal} onOpenChange={setIsOpenAlertModal}>
            <DialogTrigger asChild>
              <Button variant="outline" className="cursor-pointer flex items-center">
                <Bell className="h-4 w-4 mr-2 text-purple-400" />
                Alarm Kur
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Yeni Alarm Oluştur</DialogTitle>
                <DialogDescription>
                  Fiyat veya teknik indikatörler belirtilen seviyeye geldiğinde anlık bildirim alın.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddAlert} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Hisse Kodu</label>
                  <Input 
                    value={alertTicker}
                    onChange={(e) => setAlertTicker(e.target.value)}
                    placeholder="THYAO" 
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Kriter</label>
                  <select 
                    value={alertType}
                    onChange={(e) => setAlertType(e.target.value)}
                    className="col-span-2 h-9 rounded-md border border-input bg-secondary px-3 text-sm focus-visible:outline-none"
                  >
                    <option value="price">Fiyat</option>
                    <option value="rsi">RSI (14)</option>
                    <option value="macd">MACD Kesişimi</option>
                  </select>
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Koşul</label>
                  <Input 
                    value={alertCondition}
                    onChange={(e) => setAlertCondition(e.target.value)}
                    placeholder="Ör: > 310.50 veya < 120" 
                    className="col-span-2 bg-secondary/50" 
                    required
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Alarmı Kaydet</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Add Asset Dialog */}
          <Dialog open={isOpenAssetModal} onOpenChange={setIsOpenAssetModal}>
            <DialogTrigger asChild>
              <Button variant="default" className="cursor-pointer flex items-center">
                <Plus className="h-4 w-4 mr-2" />
                Varlık Ekle
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Portföye Varlık (Hisse veya Fon) Ekle</DialogTitle>
                <DialogDescription>
                  Portföyünüze yeni hisse senedi (örn: THYAO) veya TEFAS yatırım fonu (örn: PHE, DFI) ekleyin.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleAddAsset} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Hisse veya Fon Kodu</label>
                  <Input 
                    value={assetTicker}
                    onChange={(e) => setAssetTicker(e.target.value)}
                    placeholder="THYAO veya PHE" 
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Adet (Lot)</label>
                  <Input 
                    type="number"
                    step="any"
                    value={assetShares}
                    onChange={(e) => setAssetShares(e.target.value)}
                    placeholder="100" 
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Ort. Maliyet</label>
                  <Input 
                    type="number"
                    step="any"
                    value={assetCost}
                    onChange={(e) => setAssetCost(e.target.value)}
                    placeholder="312.50" 
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Portföye Ekle</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Edit Asset Dialog */}
          <Dialog open={isOpenEditModal} onOpenChange={setIsOpenEditModal}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Varlığı Düzenle ({selectedAsset?.ticker})</DialogTitle>
                <DialogDescription>
                  Hisse adedini ve ortalama maliyetinizi güncelleyin.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleEditAsset} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Adet (Lot)</label>
                  <Input 
                    type="number"
                    step="any"
                    value={editShares}
                    onChange={(e) => setEditShares(e.target.value)}
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Ort. Maliyet</label>
                  <Input 
                    type="number"
                    step="any"
                    value={editCost}
                    onChange={(e) => setEditCost(e.target.value)}
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" className="w-full cursor-pointer">Değişiklikleri Kaydet</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          {/* Sell Asset Dialog */}
          <Dialog open={isOpenSellModal} onOpenChange={setIsOpenSellModal}>
            <DialogContent className="sm:max-w-[425px]">
              <DialogHeader>
                <DialogTitle>Hisse Satışı ({selectedAsset?.ticker})</DialogTitle>
                <DialogDescription>
                  Portföyünüzden satmak istediğiniz hisse lot miktarını belirtin.
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleSellAsset} className="space-y-4 py-4">
                <div className="grid grid-cols-3 items-center gap-4">
                  <label className="text-sm font-semibold text-muted-foreground text-right">Satılacak Adet</label>
                  <Input 
                    type="number"
                    step="any"
                    value={sellShares}
                    onChange={(e) => setSellShares(e.target.value)}
                    placeholder={`Maks: ${selectedAsset?.shares ?? 0}`}
                    max={selectedAsset?.shares ?? undefined}
                    className="col-span-2 bg-secondary/50" 
                    required 
                  />
                </div>
                <DialogFooter className="pt-4 border-t border-border/50">
                  <Button type="submit" variant="destructive" className="w-full cursor-pointer">Satışı Gerçekleştir</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {/* Metrics Summary Row */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">PORTFÖY DEĞERİ</span>
              <Briefcase className="h-4 w-4 text-purple-400" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold font-mono text-foreground">
                ₺{currentValue.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Toplam Maliyet: ₺{totalCost.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</p>
          </CardContent>
        </Card>

        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">TOPLAM KÂR / ZARAR</span>
              <TrendingUp className="h-4 w-4 text-emerald-400" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className={`text-3xl font-extrabold font-mono ${totalProfit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                {totalProfit >= 0 ? "+" : ""}₺{totalProfit.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
              <span className={`text-sm font-semibold ${totalProfit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                ({profitPercentage.toFixed(2)}%)
              </span>
            </div>
            <p className="text-[10px] text-emerald-500/80 mt-1 font-semibold">Tüm zamanların en yüksek seviyesinde</p>
          </CardContent>
        </Card>

        <Card glass={true}>
          <CardContent className="pt-6">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground font-semibold uppercase">BETA / VOLATİLİTE</span>
              <Activity className="h-4 w-4 text-cyan-400" />
            </div>
            <div className="mt-2 flex items-baseline space-x-2">
              <span className="text-3xl font-extrabold font-mono text-foreground">0.96</span>
              <span className="text-xs text-muted-foreground font-medium">BIST 100 Dengeli</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">Riske Maruz Değer (VaR %95): %2.4</p>
          </CardContent>
        </Card>
      </div>

      {/* Grid Layout: Assets table vs Distribution & Alerts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        
        {/* Assets List Table */}
        <div className="lg:col-span-2 space-y-8">
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg">Portföy Varlıkları</CardTitle>
              <CardDescription>BIP üzerinde kayıtlı aktif hisse senedi varlıklarınız</CardDescription>
            </CardHeader>
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm text-left">
                  <thead>
                    <tr className="border-b border-border/80 text-muted-foreground text-xs font-semibold bg-secondary/15 h-11">
                      <th className="px-6">Hisse</th>
                      <th className="px-6 text-right">Adet (Lot)</th>
                      <th className="px-6 text-right">Ort. Maliyet</th>
                      <th className="px-6 text-right">Güncel Fiyat</th>
                      <th className="px-6 text-right">Toplam Değer</th>
                      <th className="px-6 text-right">Toplam Getiri (K/Z)</th>
                      <th className="px-6 text-center">İşlem</th>
                    </tr>
                  </thead>
                  <tbody>
                    {assetsList.length > 0 ? (
                      assetsList.map((item: any) => {
                        const costValue = item.shares * item.average_cost
                        const value = item.total_value || 0.0
                        const profit = item.total_profit || 0.0
                        const profitPct = item.profit_percentage || 0.0
                        return (
                          <tr key={item.ticker} className="border-b border-border/40 hover:bg-secondary/20 transition-colors h-14">
                            <td className="px-6 font-bold text-foreground">
                              <span className="bg-secondary px-2 py-1 rounded">
                                {item.ticker}
                              </span>
                            </td>
                            <td className="px-6 text-right font-mono font-medium">{item.shares}</td>
                            <td className="px-6 text-right font-mono font-medium">₺{item.average_cost.toFixed(2)}</td>
                            <td className="px-6 text-right font-mono font-medium">₺{(item.current_price || item.average_cost).toFixed(2)}</td>
                            <td className="px-6 text-right font-mono font-bold">
                              ₺{value.toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                            </td>
                            <td className="px-6 text-right font-mono font-bold">
                              <div className="flex flex-col items-end">
                                <span className={profit >= 0 ? "text-emerald-400" : "text-rose-500"}>
                                  {profit >= 0 ? "+" : ""}₺{profit.toLocaleString("tr-TR", { maximumFractionDigits: 2 })}
                                </span>
                                <span className={`text-[10px] ${profit >= 0 ? "text-emerald-400" : "text-rose-500"}`}>
                                  {profit >= 0 ? "+" : ""}{profitPct.toFixed(1)}%
                                </span>
                              </div>
                            </td>
                            <td className="px-6 text-center flex items-center justify-center h-14">
                              <button 
                                onClick={() => {
                                  setSelectedAsset(item)
                                  setSellShares("")
                                  setIsOpenSellModal(true)
                                }}
                                className="text-[10px] px-2 py-1 bg-amber-500/10 text-amber-400 border border-amber-500/20 hover:bg-amber-500/20 rounded mr-2 transition-all cursor-pointer font-semibold"
                              >
                                Sat
                              </button>
                              <button 
                                onClick={() => {
                                  setSelectedAsset(item)
                                  setEditShares(item.shares.toString())
                                  setEditCost(item.average_cost.toString())
                                  setIsOpenEditModal(true)
                                }}
                                className="text-[10px] px-2 py-1 bg-blue-500/10 text-blue-400 border border-blue-500/20 hover:bg-blue-500/20 rounded mr-2 transition-all cursor-pointer font-semibold"
                              >
                                Düzenle
                              </button>
                              <button 
                                onClick={() => handleDeleteAsset(item.id)}
                                className="text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                                title="Tamamen Sil"
                              >
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </td>
                          </tr>
                        )
                      })
                    ) : (
                      <tr>
                        <td colSpan={7} className="text-center py-8 text-xs text-muted-foreground">
                          Portföyünüzde henüz hisse senedi bulunmamaktadır.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Side Column: Chart & Alerts list */}
        <div className="space-y-8">
          
          {/* Asset Weight Distribution */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <PieIcon className="h-4 w-4 text-purple-400 mr-2" />
                Varlık Dağılımı
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col items-center">
              <div className="h-48 w-full">
                {pieData.length > 0 ? (
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={45}
                        outerRadius={65}
                        paddingAngle={4}
                        dataKey="value"
                      >
                        {pieData.map((entry: any, index: number) => (
                          <Cell key={`cell-${index}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(value) => value !== undefined && value !== null ? `₺${Number(value).toLocaleString("tr-TR")}` : ""} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="h-full flex items-center justify-center text-xs text-muted-foreground">Dağılım verisi bulunamadı</div>
                )}
              </div>
              <div className="w-full space-y-2 mt-4">
                {pieData.map((entry: any) => {
                  const pct = currentValue > 0 ? ((entry.value / currentValue) * 100).toFixed(1) : "0.0"
                  return (
                    <div key={entry.name} className="flex items-center justify-between text-xs font-semibold">
                      <div className="flex items-center text-muted-foreground">
                        <span className="h-2.5 w-2.5 rounded-full mr-2" style={{ backgroundColor: entry.color }} />
                        {entry.name}
                      </div>
                      <span className="font-mono text-foreground">{pct}%</span>
                    </div>
                  )
                })}
              </div>
            </CardContent>
          </Card>

          {/* Active Alerts List */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-lg flex items-center">
                <Bell className="h-4 w-4 text-primary mr-2" />
                Alarmlarım
              </CardTitle>
              <CardDescription>Canlı BIST fiyat tetikleyicileriniz</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {alerts.length > 0 ? (
                alerts.map((alert: any) => (
                  <div key={alert.id} className={`flex items-center justify-between p-3 rounded-lg border text-xs transition-colors ${
                    alert.is_triggered 
                      ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-400" 
                      : "border-border bg-secondary/20 text-muted-foreground"
                  }`}>
                    <div className="space-y-1">
                      <div className="flex items-center space-x-2">
                        <span className="font-extrabold bg-secondary px-1.5 py-0.5 rounded text-foreground">
                          {alert.ticker}
                        </span>
                        <span className="font-semibold text-muted-foreground">({alert.alert_type === "price" ? "Fiyat" : alert.alert_type.toUpperCase()})</span>
                      </div>
                      <p className="font-mono font-bold text-foreground/90">
                        {alert.trigger_condition.operator} {alert.trigger_condition.value}
                      </p>
                    </div>
                    <div className="flex items-center space-x-2">
                      <button 
                        onClick={() => handleToggleAlert(alert.id)}
                        className="text-muted-foreground hover:text-foreground transition-colors cursor-pointer"
                        disabled={alert.is_triggered}
                      >
                        {alert.is_triggered ? (
                          <span className="bg-emerald-500/10 text-emerald-400 px-1.5 py-0.5 rounded border border-emerald-500/15 text-[10px] font-bold">
                            Tetiklendi
                          </span>
                        ) : alert.is_active ? (
                          <ToggleRight className="h-6 w-6 text-primary" />
                        ) : (
                          <ToggleLeft className="h-6 w-6" />
                        )}
                      </button>
                      <button 
                        onClick={() => handleDeleteAlert(alert.id)}
                        className="text-muted-foreground hover:text-rose-500 transition-colors cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-xs text-muted-foreground py-4">Henüz kurulmuş bir alarm bulunmamaktadır.</p>
              )}
            </CardContent>
          </Card>

        </div>

      </div>
    </div>
  )
}
