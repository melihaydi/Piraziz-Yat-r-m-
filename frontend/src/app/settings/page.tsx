"use client"

import React, { useState, useEffect } from "react"
import { User, Shield, HelpCircle, Mail, Phone, Lock, CheckCircle2, Sparkles, Image as ImageIcon } from "lucide-react"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/Card"
import { Button } from "@/components/ui/Button"
import { Input } from "@/components/ui/Input"

const AVATAR_OPTIONS = [
  { emoji: "💼", label: "Yatırımcı" },
  { emoji: "📈", label: "Trader" },
  { emoji: "🎯", label: "Analist" },
  { emoji: "🦁", label: "Aslan" },
  { emoji: "🚀", label: "Boğa" }
]

export default function SettingsPage() {
  const [username, setUsername] = useState("Ömer Faruk")
  const [avatarEmoji, setAvatarEmoji] = useState("💼")
  const [profilePic, setProfilePic] = useState("")
  const [email, setEmail] = useState("omerfaruk@bip.com")
  const [password, setPassword] = useState("••••••••")
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [authSuccess, setAuthSuccess] = useState(false)

  // Load user data from localStorage on mount
  useEffect(() => {
    const savedName = localStorage.getItem("bip_username")
    const savedEmoji = localStorage.getItem("bip_avatar_emoji")
    const savedPic = localStorage.getItem("bip_profile_pic")
    if (savedName) setUsername(savedName)
    if (savedEmoji) setAvatarEmoji(savedEmoji)
    if (savedPic) setProfilePic(savedPic)
  }, [])

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      const reader = new FileReader()
      reader.onloadend = () => {
        const base64String = reader.result as string
        setProfilePic(base64String)
      }
      reader.readAsDataURL(file)
    }
  }

  const handleSaveProfile = (e: React.FormEvent) => {
    e.preventDefault()
    localStorage.setItem("bip_username", username)
    localStorage.setItem("bip_avatar_emoji", avatarEmoji)
    localStorage.setItem("bip_profile_pic", profilePic)
    
    // Dispatch custom event to notify Header of changes
    window.dispatchEvent(new Event("profile-updated"))

    setSaveSuccess(true)
    setTimeout(() => setSaveSuccess(false), 3000)
  }

  const handleMockAuth = (e: React.FormEvent) => {
    e.preventDefault()
    setAuthSuccess(true)
    setTimeout(() => setAuthSuccess(false), 3000)
  }

  return (
    <div className="space-y-8 max-w-4xl mx-auto">
      {/* Title */}
      <div>
        <h1 className="text-3xl font-extrabold tracking-tight">Hesap ve Uygulama Ayarları</h1>
        <p className="text-muted-foreground mt-1">
          Kullanıcı profilinizi güncelleyin, hesap bilgilerini yönetin veya destek ekibiyle iletişime geçin.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
        
        {/* Left Side: Navigation Quick Links */}
        <div className="space-y-4">
          <Card glass={true} className="p-2">
            <div className="space-y-1">
              <button className="w-full flex items-center px-4 py-3 text-sm font-semibold rounded-lg bg-primary text-primary-foreground shadow-md transition-all text-left">
                <User className="h-4 w-4 mr-3" />
                Profil Bilgileri
              </button>
              <button className="w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg text-muted-foreground hover:bg-secondary/40 hover:text-foreground transition-all text-left">
                <Shield className="h-4 w-4 mr-3" />
                Güvenlik & Yetkiler
              </button>
              <button className="w-full flex items-center px-4 py-3 text-sm font-medium rounded-lg text-muted-foreground hover:bg-secondary/40 hover:text-foreground transition-all text-left">
                <HelpCircle className="h-4 w-4 mr-3" />
                Yardım ve Destek
              </button>
            </div>
          </Card>

          {/* Premium Status Card */}
          <Card glass={true} className="bg-gradient-to-br from-card to-emerald-950/10 border-emerald-500/20">
            <CardContent className="pt-6 text-center space-y-3">
              <div className="inline-flex p-2.5 bg-emerald-500/10 rounded-full text-emerald-400 border border-emerald-500/20">
                <Sparkles className="h-5 w-5" />
              </div>
              <h3 className="font-extrabold text-sm text-foreground">Premium Lisans Aktif</h3>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Piraziz Yatırım gerçek zamanlı BIST30 & TEFAS fon veri akış lisansınız aktiftir.
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Right Side: Tab Forms */}
        <div className="md:col-span-2 space-y-8">
          
          {/* Profile Form */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <User className="h-4.5 w-4.5 mr-2 text-primary" />
                Profil Düzenleme
              </CardTitle>
              <CardDescription>Uygulama genelinde gösterilecek isminiz ve avatarınız.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSaveProfile} className="space-y-5">
                {/* Profile Picture Upload Section (Avatar image, Request 4!) */}
                <div className="flex items-center space-x-4 p-4 bg-secondary/15 rounded-xl border border-border/30">
                  <div className="relative h-16 w-16 rounded-full border border-border flex items-center justify-center text-3xl bg-secondary/50 overflow-hidden shrink-0">
                    {profilePic ? (
                      <img src={profilePic} className="h-full w-full object-cover" alt="Profile" />
                    ) : (
                      <span>{avatarEmoji}</span>
                    )}
                  </div>
                  
                  <div className="space-y-1.5 flex-1">
                    <label className="text-xs text-muted-foreground font-semibold block">Profil Fotoğrafı Yükle</label>
                    <input 
                      type="file" 
                      accept="image/*" 
                      onChange={handleImageUpload}
                      className="text-xs text-muted-foreground file:mr-3 file:py-1 file:px-3 file:rounded-md file:border-0 file:text-xs file:font-semibold file:bg-primary file:text-primary-foreground hover:file:opacity-90 file:cursor-pointer"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">Görünen Ad</label>
                  <Input 
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    placeholder="Ömer Faruk"
                    className="bg-secondary/30"
                    required
                  />
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">Avatar Seçimi</label>
                  <div className="grid grid-cols-5 gap-2.5">
                    {AVATAR_OPTIONS.map((opt) => (
                      <button
                        key={opt.emoji}
                        type="button"
                        onClick={() => setAvatarEmoji(opt.emoji)}
                        className={`h-14 rounded-lg border flex flex-col items-center justify-center text-xl transition-all cursor-pointer ${
                          avatarEmoji === opt.emoji 
                            ? "bg-primary/10 border-primary text-primary scale-105 shadow-md shadow-primary/5" 
                            : "bg-secondary/20 border-border hover:bg-secondary/40"
                        }`}
                      >
                        <span>{opt.emoji}</span>
                        <span className="text-[9px] text-muted-foreground mt-1 font-semibold">{opt.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {saveSuccess && (
                  <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/15">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Profil ayarlarınız başarıyla kaydedildi!</span>
                  </div>
                )}

                <Button type="submit" className="w-full cursor-pointer font-bold text-xs h-10">Değişiklikleri Kaydet</Button>
              </form>
            </CardContent>
          </Card>

          {/* Login / Sign Up Form */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <Lock className="h-4.5 w-4.5 mr-2 text-primary" />
                Giriş & Yetkilendirme
              </CardTitle>
              <CardDescription>Piraziz Yatırım kullanıcı hesabınızı doğrulayın.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleMockAuth} className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">E-posta Adresi</label>
                  <Input 
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="bg-secondary/30"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground font-semibold">Şifre</label>
                  <Input 
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="bg-secondary/30"
                    required
                  />
                </div>

                {authSuccess && (
                  <div className="flex items-center space-x-2 text-emerald-400 text-xs font-semibold bg-emerald-500/10 p-3 rounded-lg border border-emerald-500/15">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Giriş / Kayıt başarıyla doğrulandı!</span>
                  </div>
                )}

                <div className="grid grid-cols-2 gap-4 pt-2">
                  <Button type="submit" className="w-full cursor-pointer font-bold text-xs h-10">Giriş Yap</Button>
                  <Button type="button" variant="outline" onClick={() => setAuthSuccess(true)} className="w-full cursor-pointer font-bold text-xs h-10">Kayıt Ol</Button>
                </div>
              </form>
            </CardContent>
          </Card>

          {/* Help & Support (Request 13) */}
          <Card glass={true}>
            <CardHeader>
              <CardTitle className="text-base flex items-center">
                <HelpCircle className="h-4.5 w-4.5 mr-2 text-primary" />
                Destek & İletişim
              </CardTitle>
              <CardDescription>Sorularınız veya teknik problemleriniz için bizimle iletişime geçin.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-xs font-medium">
              <div className="flex items-center p-3.5 bg-secondary/20 rounded-lg border border-border/30">
                <Mail className="h-5 w-5 text-primary mr-3" />
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">E-posta Destek</p>
                  <p className="text-foreground font-mono text-sm">destek@pirazizyatirim.com</p>
                </div>
              </div>
              <div className="flex items-center p-3.5 bg-secondary/20 rounded-lg border border-border/30">
                <Phone className="h-5 w-5 text-primary mr-3" />
                <div className="space-y-0.5">
                  <p className="text-[10px] text-muted-foreground uppercase font-semibold">Çağrı Merkezi</p>
                  <p className="text-foreground font-mono text-sm">444 0 799</p>
                </div>
              </div>
            </CardContent>
          </Card>

        </div>
      </div>
    </div>
  )
}
