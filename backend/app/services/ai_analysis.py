import json
import logging
from typing import Any, Dict, List, Optional
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

class AIAnalysisService:
    def __init__(self):
        self.api_key = settings.GEMINI_API_KEY
        # "gemini-2.5-flash" is listed in the models catalog for this key but
        # actually calling it 404s with "no longer available to new users" -
        # verified directly against the API before picking this. gemini-flash-
        # latest is Google's maintained alias for the current-recommended
        # flash model, confirmed working with a live test call.
        self.url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-flash-latest:generateContent"

    def _call_gemini(self, prompt: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        """Calls Gemini API via raw HTTP with structured JSON output schema."""
        if not self.api_key:
            logger.warning("GEMINI_API_KEY is not configured. Falling back to local rule-based generator.")
            raise ValueError("Gemini key missing")

        payload = {
            "contents": [
                {
                    "parts": [
                        {
                            "text": prompt
                        }
                    ]
                }
            ],
            "generationConfig": {
                "responseMimeType": "application/json",
                "responseSchema": schema
            }
        }

        try:
            params = {"key": self.api_key}
            response = httpx.post(self.url, params=params, json=payload, timeout=15.0)
            response.raise_for_status()
            
            data = response.json()
            # Extract JSON string from Gemini response structure
            text_response = data["candidates"][0]["content"]["parts"][0]["text"]
            return json.loads(text_response)
        except Exception as e:
            logger.error(f"Gemini API call failed: {e}")
            raise



    def analyze_financials(
        self, 
        ticker: str, 
        current_data: Dict[str, float], 
        previous_data: Optional[Dict[str, float]] = None,
        sector_name: str = "Tümü",
        candles: Optional[List[Dict[str, Any]]] = None
    ) -> Dict[str, Any]:
        """Calculates financial ratios & technical indicators and feeds them to Gemini for dynamic analysis comments."""
        sales = current_data.get("sales", 0.0)
        ebitda = current_data.get("ebitda", 0.0)
        net_profit = current_data.get("net_profit", 0.0)
        cash = current_data.get("cash", 0.0)
        total_debt = current_data.get("total_debt", 0.0)
        net_debt = total_debt - cash
        
        ebitda_margin = (ebitda / sales * 100) if sales > 0 else 0.0
        net_margin = (net_profit / sales * 100) if sales > 0 else 0.0
        net_debt_ebitda = (net_debt / ebitda) if ebitda > 0 else 0.0

        sales_growth = 0.0
        ebitda_growth = 0.0
        net_profit_growth = 0.0
        
        if previous_data:
            prev_sales = previous_data.get("sales", 0.0)
            prev_ebitda = previous_data.get("ebitda", 0.0)
            prev_net_profit = previous_data.get("net_profit", 0.0)
            
            sales_growth = ((sales - prev_sales) / prev_sales * 100) if prev_sales > 0 else 0.0
            ebitda_growth = ((ebitda - prev_ebitda) / prev_ebitda * 100) if prev_ebitda > 0 else 0.0
            net_profit_growth = ((net_profit - prev_net_profit) / prev_net_profit * 100) if prev_net_profit > 0 else 0.0

        # Calculate technical details dynamically
        trend_status = "Yatay"
        support_level = "Belirlenemedi"
        resistance_level = "Belirlenemedi"
        rsi_val = 50.0
        macd_val = "Nötr"
        momentum_status = "Dengeli"
        trend_strength = "Zayıf/Yatay"
        
        if candles and len(candles) >= 10:
            from app.services.technical_analysis import TechnicalAnalysisService
            closes = [float(c["close"]) for c in candles]
            highs = [float(c["high"]) for c in candles]
            lows = [float(c["low"]) for c in candles]
            
            # Trend positioning
            ema20 = TechnicalAnalysisService.calculate_ema(closes, 20)[-1]
            if ema20 and closes[-1] > ema20:
                trend_status = "Yükseliş"
            else:
                trend_status = "Düşüş"
                
            # RSI & MACD
            rsi_list = TechnicalAnalysisService.calculate_rsi(closes, 14)
            rsi_val = rsi_list[-1] if rsi_list and rsi_list[-1] is not None else 50.0
            if rsi_val > 70:
                momentum_status = "Aşırı Alım"
            elif rsi_val < 30:
                momentum_status = "Aşırı Satım"
            else:
                momentum_status = "Güçlü" if closes[-1] > ema20 else "Zayıf"
                
            macd_line, sig_line, _ = TechnicalAnalysisService.calculate_macd(closes)
            if macd_line and sig_line and macd_line[-1] is not None and sig_line[-1] is not None:
                macd_val = "AL" if macd_line[-1] > sig_line[-1] else "SAT"
                
            # ADX trend strength
            adx_list = TechnicalAnalysisService.calculate_adx(highs, lows, closes, 14)
            adx_val = adx_list[-1] if adx_list and adx_list[-1] is not None else 25.0
            trend_strength = "Kararlı" if adx_val > 25 else "Zayıf/Yatay"
            
            # Support/Resistance
            sr = TechnicalAnalysisService.detect_support_resistance(highs, lows)
            sups = sr.get("supports", [])
            res = sr.get("resistances", [])
            if sups:
                support_level = f"{sups[-1]:.2f} ₺"
            if res:
                resistance_level = f"{res[-1]:.2f} ₺"

        ratio_summary = (
            f"Şirket Kodu: {ticker}\n"
            f"Sektör: {sector_name}\n"
            f"Net Satışlar: ₺{sales:,.2f} (Büyüme: %{sales_growth:.2f})\n"
            f"FAVÖK: ₺{ebitda:,.2f} (Büyüme: %{ebitda_growth:.2f}, Marj: %{ebitda_margin:.2f})\n"
            f"Net Kâr: ₺{net_profit:,.2f} (Büyüme: %{net_profit_growth:.2f}, Marj: %{net_margin:.2f})\n"
            f"Net Borç / FAVÖK: {net_debt_ebitda:.2f}\n"
            f"--- Teknik İndikatör Değerleri ---\n"
            f"Trend Durumu: {trend_status}\n"
            f"Destek Noktası: {support_level}\n"
            f"Direnç Noktası: {resistance_level}\n"
            f"RSI (14) Değeri: {rsi_val:.1f}\n"
            f"MACD Sinyali: {macd_val}\n"
            f"Momentum: {momentum_status}\n"
            f"Trend Gücü (ADX): {trend_strength}\n"
        )

        prompt = (
            "Aşağıda bir BIST şirketinin doğruluğu hesaplanmış finansal rasyoları ve teknik indikatör durumları verilmiştir. "
            "Bu verilere dayanarak Türkçe kapsamlı bir yatırım analiz raporu yaz. Analizde verilen rasyolardan sapma yapma.\n\n"
            f"{ratio_summary}\n\n"
            "Analiz raporu şu yapıda olmalıdır:\n"
            "- executive_summary: 2-3 cümlelik yönetici özeti.\n"
            "- long_comment: Detaylı, rasyolara dayalı uzun yatırımcı yorumu.\n"
            "- short_summary: Sosyal medyada paylaşılabilecek kısalıkta tek cümlelik özet.\n"
            "- strengths: Şirketin rasyolarına göre en güçlü 2-3 yönü (liste).\n"
            "- weaknesses: Şirketin rasyolarına göre en zayıf 2-3 yönü (liste).\n"
            "- risks: Önümüzdeki dönemler için en önemli 2 risk (liste).\n"
            "- opportunities: Önümüzdeki dönemler için en önemli 2 fırsat (liste).\n"
            "- trend: Teknik trend durumu ('Yükseliş', 'Düşüş', 'Yatay').\n"
            "- support: Destek fiyat seviyesi.\n"
            "- resistance: Direnç fiyat seviyesi.\n"
            "- risk_level: Risk seviyesi ('Düşük', 'Orta', 'Yüksek').\n"
            "- ai_comment: Hisse hakkında detaylı teknik yapay zeka yorumu.\n"
            "- momentum: Momentum durumu ('Güçlü', 'Zayıf', 'Dengeli').\n"
            "- trend_strength: Trend gücü ('Kararlı', 'Zayıf/Yatay').\n"
            "- short_term_expectation: Kısa vadeli beklenti ('Pozitif', 'Negatif', 'Nötr').\n"
            "- medium_term_expectation: Orta vadeli beklenti ('Pozitif', 'Negatif', 'Nötr').\n"
            "- general_summary: Genel özet tek cümle."
        )

        schema = {
            "type": "OBJECT",
            "properties": {
                "executive_summary": {"type": "STRING"},
                "long_comment": {"type": "STRING"},
                "short_summary": {"type": "STRING"},
                "strengths": {"type": "ARRAY", "items": {"type": "STRING"}},
                "weaknesses": {"type": "ARRAY", "items": {"type": "STRING"}},
                "risks": {"type": "ARRAY", "items": {"type": "STRING"}},
                "opportunities": {"type": "ARRAY", "items": {"type": "STRING"}},
                "trend": {"type": "STRING"},
                "support": {"type": "STRING"},
                "resistance": {"type": "STRING"},
                "risk_level": {"type": "STRING"},
                "ai_comment": {"type": "STRING"},
                "momentum": {"type": "STRING"},
                "trend_strength": {"type": "STRING"},
                "short_term_expectation": {"type": "STRING"},
                "medium_term_expectation": {"type": "STRING"},
                "general_summary": {"type": "STRING"}
            },
            "required": [
                "executive_summary", "long_comment", "short_summary", "strengths", "weaknesses", "risks", "opportunities",
                "trend", "support", "resistance", "risk_level", "ai_comment", "momentum", "trend_strength",
                "short_term_expectation", "medium_term_expectation", "general_summary"
            ]
        }

        try:
            return self._call_gemini(prompt, schema)
        except Exception:
            logger.info("Using local rule-based financial analysis generator.")
            return self._generate_local_financial_analysis(
                ticker, sales_growth, ebitda_margin, net_debt_ebitda,
                trend_status, support_level, resistance_level, rsi_val, momentum_status, trend_strength
            )

    def analyze_kap_announcement(self, ticker: str, title: str, content: str) -> Dict[str, Any]:
        """Summarizes and evaluates KAP disclosures using live TradingView data and company metrics."""
        # 1. Fetch live market data from MarketDataService
        from app.services.market_data import market_data_service
        quote = market_data_service.get_quote(ticker)
        
        live_price = 0.0
        change_pct = 0.0
        pe = 0.0
        mcap = 0.0
        if quote:
            live_price = quote.get("last") or 0.0
            change_pct = quote.get("change_percent") or 0.0
            pe = quote.get("pe_ratio") or 0.0
            mcap = quote.get("market_cap") or 0.0
            
        # 2. Build live market context
        market_context = (
            f"Güncel Hisse Fiyatı: ₺{live_price:.2f}\n"
            f"Günlük Değişim: %{change_pct:.2f}\n"
            f"F/K (PE) Oranı: {pe:.2f}\n"
            f"Piyasa Değeri: ₺{mcap:,.2f}"
        )

        prompt = (
            "Aşağıdaki KAP bildirimini, şirketin güncel canlı borsa fiyat verileri ve piyasa koşulları ile birlikte analiz et.\n\n"
            f"Hisse: {ticker}\n"
            f"Canlı Piyasa Verileri:\n{market_context}\n\n"
            f"KAP Bildirimi Başlığı: {title}\n"
            f"KAP Bildirimi İçeriği: {content}\n\n"
            "Analiz raporu şu Türkçe yapıda olmalıdır:\n"
            "- summary: Bildirimin güncel koşullarda anlaşılır 1-2 cümlelik özeti.\n"
            "- importance: Bildirimin önem derecesi ('low', 'medium', 'high').\n"
            "- affected_financial_lines: Doğrudan veya dolaylı etkilenebilecek finansal kalemler (liste).\n"
            "- short_term_impact: Bildirimin hisse fiyatına kısa vadeli olası etkisi (güncel fiyat ve günlük değişim göz önünde bulundurularak).\n"
            "- long_term_impact: Şirketin temel değerine ve F/K oranına uzun vadeli olası etkisi.\n"
            "- sentiment: Bildirimin hisse üzerindeki genel etkisi ('positive', 'neutral', 'negative').\n"
            "- impact_score: Hisse üzerindeki net etki puanı (0 ile 100 arasında, 50 nötr)."
        )

        schema = {
            "type": "OBJECT",
            "properties": {
                "summary": {"type": "STRING"},
                "importance": {"type": "STRING"},
                "affected_financial_lines": {"type": "ARRAY", "items": {"type": "STRING"}},
                "short_term_impact": {"type": "STRING"},
                "long_term_impact": {"type": "STRING"},
                "sentiment": {"type": "STRING"},
                "impact_score": {"type": "INTEGER"}
            },
            "required": ["summary", "importance", "affected_financial_lines", "short_term_impact", "long_term_impact", "sentiment", "impact_score"]
        }

        try:
            return self._call_gemini(prompt, schema)
        except Exception:
            logger.info("Using local rule-based KAP analysis generator with live data.")
            return self._generate_local_kap_analysis_with_live(ticker, title, live_price, change_pct)

    def _generate_local_financial_analysis(
        self, ticker: str, sales_growth: float, ebitda_margin: float, net_debt_ebitda: float,
        trend_status: str = "Yatay", support_level: str = "Belirlenemedi", resistance_level: str = "Belirlenemedi",
        rsi_val: float = 50.0, momentum_status: str = "Dengeli", trend_strength: str = "Zayıf/Yatay"
    ) -> Dict[str, Any]:
        """Generates high-quality mock financial and technical analysis matched to calculated metrics (Request 3!)."""
        strength_list = []
        weakness_list = []
        
        if sales_growth > 10:
            strength_list.append(f"Net satışlar yıllık bazda %{sales_growth:.1f} büyüme kaydederek güçlü talep artışına işaret etti.")
        else:
            weakness_list.append(f"Net satış büyümesi %{sales_growth:.1f} seviyesinde kalarak enflasyon karşısında reel daralma gösterdi.")
            
        if ebitda_margin > 15:
            strength_list.append(f"FAVÖK marjı %{ebitda_margin:.1f} seviyesinde gerçekleşerek yüksek operasyonel karlılığa ulaştı.")
        else:
            weakness_list.append(f"FAVÖK marjı %{ebitda_margin:.1f} seviyesine gerileyerek maliyet baskılarının operasyonel karlılığı olumsuz etkilediğini gösterdi.")
            
        if net_debt_ebitda < 1.5:
            strength_list.append(f"Net Borç / FAVÖK oranı {net_debt_ebitda:.2f} ile oldukça güvenli ve borç yükü hafif bir bilançoya işaret etmektedir.")
        else:
            weakness_list.append(f"Net Borç / FAVÖK oranı {net_debt_ebitda:.2f} seviyesine yükselerek finansman giderlerinin kârlılık üzerindeki baskısını artırdı.")

        if not strength_list:
            strength_list.append("Maliyet kontrollerinin dengeli seyrini koruması.")
        if not weakness_list:
            weakness_list.append("Küresel makroekonomik dalgalanmalardan kaynaklanan marj volatilite riski.")

        executive_summary = (
            f"{ticker} şirketinin son dönem finansal sonuçları, "
            f"satışların %{sales_growth:.1f} artması ve FAVÖK marjının %{ebitda_margin:.1f} seviyesinde "
            f"dengelenmesi ile {'olumlu' if ebitda_margin > 12 and net_debt_ebitda < 2.0 else 'temkinli'} bir görünüm sergilemektedir."
        )

        long_comment = (
            f"Şirket finansal oranlarında yapılan incelemeye göre; Net satışlar geçen yıla oranla %{sales_growth:.1f} "
            f"seviyesinde değişim gösterirken, operasyonel kârlılığı temsil eden FAVÖK marjı %{ebitda_margin:.1f} "
            f"olarak gerçekleşti. Net Borç / FAVÖK rasyosunun {net_debt_ebitda:.2f} seviyesinde bulunması finansal risklerin "
            f"{'düşük seviyede kaldığını' if net_debt_ebitda < 1.5 else 'takip edilmesi gerektiğini'} teyit ediyor. "
            f"Bu finansal oranlar operasyonel verimliliğin ve nakit yönetiminin genel seyrini desteklemektedir."
        )

        short_summary = (
            f"Net satışlar %{sales_growth:.1f} artarken, FAVÖK marjı %{ebitda_margin:.1f} seviyesinde dengelendi. "
            f"Finansal görünüm {'olumlu' if net_debt_ebitda < 1.5 else 'temkinli'} seyrini koruyor."
        )

        risk_level = "Düşük" if ebitda_margin > 15 and net_debt_ebitda < 1.5 else "Yüksek" if net_debt_ebitda > 3.5 else "Orta"
        short_term_expectation = "Pozitif" if trend_status == "Yükseliş" else "Negatif" if trend_status == "Düşüş" else "Nötr"
        medium_term_expectation = "Pozitif" if ebitda_margin > 12 else "Nötr"

        return {
            "executive_summary": executive_summary,
            "long_comment": long_comment,
            "short_summary": short_summary,
            "strengths": strength_list,
            "weaknesses": weakness_list,
            "risks": [
                "Finansman maliyetlerinin yüksek seyretmesi nedeniyle artan borçlanma yükü.",
                "Sektörel bazda girdi maliyetleri enflasyonunun marjları daraltma riski."
            ],
            "opportunities": [
                "Yeni ihracat pazarlarına açılım ile döviz bazlı gelir kanallarının genişlemesi.",
                "Operasyonel dijitalleşme ile genel yönetim giderlerinde sağlanabilecek tasarruflar."
            ],
            "trend": trend_status,
            "support": support_level,
            "resistance": resistance_level,
            "risk_level": risk_level,
            "ai_comment": f"{ticker} teknik analiz göstergelerinde {trend_status} eğiliminde seyretmekte olup, RSI {rsi_val:.1f} ile {momentum_status} görünüm vermektedir. Kısa vadeli pivot seviyeler sırasıyla destek {support_level} ve direnç {resistance_level} olarak izlenmelidir.",
            "momentum": momentum_status,
            "trend_strength": trend_strength,
            "short_term_expectation": short_term_expectation,
            "medium_term_expectation": medium_term_expectation,
            "general_summary": f"Teknik olarak {trend_status} trendi ve {trend_strength} trend gücü ile dengeli bir görünüm sergilemektedir."
        }

    def _generate_local_kap_analysis(self, ticker: str, title: str) -> Dict[str, Any]:
        """Generates mock KAP analysis values based on keywords found in the title."""
        title_lower = title.lower().replace("i̇", "i").replace("ı", "i")
        sentiment = "neutral"
        impact_score = 50
        importance = "medium"
        summary = f"{ticker} tarafından gönderilen özel durum açıklaması."
        short_impact = "Piyasa üzerinde nötr etki beklenmektedir."
        long_impact = "Uzun vadede finansal rasyolara etkisi sınırlıdır."
        affected_lines = ["Genel Operasyonel Kar"]

        if any(w in title_lower for w in ["kar", "kâr", "artış", "olumlu", "teşvik", "kazanç", "ihale"]):
            sentiment = "positive"
            impact_score = 80
            importance = "high"
            summary = f"{ticker} şirketinin operasyonel kârlılığını veya iş hacmini artıracak olumlu KAP açıklaması."
            short_impact = "Hisse senedi fiyatı üzerinde kısa vadeli pozitif momentum oluşturabilir."
            long_impact = "Uzun vadeli ciro büyümesini ve nakit akışını destekleyici niteliktedir."
            affected_lines = ["Net Satış Gelirleri", "Dönem Net Kârı"]
        elif any(w in title_lower for w in ["duruş", "azalış", "olumsuz", "kayıp", "dava", "ceza"]):
            sentiment = "negative"
            impact_score = 25
            importance = "high"
            summary = f"{ticker} şirketinin üretimi veya finansal marjları üzerinde geçici baskı oluşturabilecek KAP açıklaması."
            short_impact = "Kısa vadede hisse senedi fiyatında satış baskısı yaratabilir."
            long_impact = "Geçici operasyonel yavaşlama oluşturabilecek olsa da uzun vadeli hedefleri etkilemesi beklenmemektedir."
            affected_lines = ["Brüt Satış Hacmi", "Üretim Miktarı"]

        return {
            "summary": summary,
            "importance": importance,
            "affected_financial_lines": affected_lines,
            "short_term_impact": short_impact,
            "long_term_impact": long_impact,
            "sentiment": sentiment,
            "impact_score": impact_score
        }

    def _generate_local_kap_analysis_with_live(self, ticker: str, title: str, live_price: float, change_pct: float) -> Dict[str, Any]:
        """Generates grounded KAP analysis using live stock prices and keywords."""
        title_lower = title.lower().replace("i̇", "i").replace("ı", "i")
        sentiment = "neutral"
        impact_score = 50
        importance = "medium"
        summary = f"{ticker} tarafından gönderilen özel durum açıklaması."
        short_impact = f"Hisse {live_price:.2f} TL fiyattan işlem görürken gelen bildirim, kısa vadede nötr etki yaratabilir."
        long_impact = "Uzun vadede finansal rasyolara ve F/K oranına etkisi sınırlıdır."
        affected_lines = ["Genel Operasyonel Kar"]

        if any(w in title_lower for w in ["kar", "kâr", "artış", "olumlu", "teşvik", "kazanç", "ihale"]):
            sentiment = "positive"
            impact_score = 80
            importance = "high"
            summary = f"{ticker} şirketinin iş hacmini veya kârlılığını artıracak olumlu açıklama."
            short_impact = f"Fiyatın {live_price:.2f} TL ve günlük değişimin %{change_pct:+.2f} olduğu piyasada, bu bildirim kısa vadeli alım momentumunu güçlendirebilir."
            long_impact = "Orta ve uzun vadeli ciro büyümesini ve serbest nakit akışı verimliliğini destekleyebilir."
            affected_lines = ["Net Satış Gelirleri", "Dönem Net Kârı"]
        elif any(w in title_lower for w in ["duruş", "azalış", "olumsuz", "kayıp", "dava", "ceza"]):
            sentiment = "negative"
            impact_score = 25
            importance = "high"
            summary = f"{ticker} şirketinin üretimi veya finansal marjları üzerinde geçici baskı oluşturabilecek açıklama."
            short_impact = f"Fiyatın {live_price:.2f} TL ve günlük değişimin %{change_pct:+.2f} olduğu piyasada, bu bildirim kısa vadede geçici bir kâr satışı baskısı yaratabilir."
            long_impact = "Geçici operasyonel yavaşlama veya maliyet artışı yaratabilecek olsa da, uzun vadeli büyüme potansiyeline etkisi sınırlıdır."
            affected_lines = ["Brüt Satış Hacmi", "Üretim Miktarı"]

        return {
            "summary": summary,
            "importance": importance,
            "affected_financial_lines": affected_lines,
            "short_term_impact": short_impact,
            "long_term_impact": long_impact,
            "sentiment": sentiment,
            "impact_score": impact_score
        }

ai_analysis_service = AIAnalysisService()
