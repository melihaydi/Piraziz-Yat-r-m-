"""Shared BIST sector mapping - used by both the screener (stock cards) and
portfolio analytics (sector allocation breakdown), so the two don't drift
into two different, partially-overlapping sector maps."""

SECTOR_MAP = {
    # Ulaştırma
    "THYAO": "Ulaştırma", "PGSUS": "Ulaştırma", "TAVHL": "Ulaştırma", "CLEBI": "Ulaştırma",
    # Metal Sanayi
    "EREGL": "Metal Sanayi", "KRDMD": "Metal Sanayi", "KRDMA": "Metal Sanayi", "KRDMB": "Metal Sanayi", "BRSAN": "Metal Sanayi", "ISDMR": "Metal Sanayi",
    # Enerji
    "TUPRS": "Enerji", "AKSEN": "Enerji", "ENJSA": "Enerji", "ZOREN": "Enerji", "ASTOR": "Enerji", "KONTR": "Enerji", "ODAS": "Enerji", "SMRTG": "Enerji", "CWENE": "Enerji", "YEOTK": "Enerji", "ALFAS": "Enerji", "GESAN": "Enerji", "EUPWR": "Enerji",
    # Savunma
    "ASELS": "Savunma", "SDTTR": "Savunma", "OTKAR": "Savunma",
    # Bankacılık
    "AKBNK": "Bankacılık", "GARAN": "Bankacılık", "YKBNK": "Bankacılık", "ISCTR": "Bankacılık", "VAKBN": "Bankacılık", "HALKB": "Bankacılık", "TSKB": "Bankacılık", "SKBNK": "Bankacılık",
    # Perakende
    "BIMAS": "Perakende", "MGROS": "Perakende", "SOKM": "Perakende",
    # Kimya
    "SASA": "Kimya", "HEKTS": "Kimya", "PETKM": "Kimya", "GUBRF": "Kimya",
    # Holding
    "KCHOL": "Holding", "SAHOL": "Holding", "DOHOL": "Holding", "ALARK": "Holding", "AGHOL": "Holding",
    # Sınai / Teknoloji / Çimento
    "SISE": "Cam Sanayi", "ARCLK": "Dayanıklı Tüketim", "VESTL": "Dayanıklı Tüketim", "FROTO": "Otomotiv", "TOASO": "Otomotiv",
    "MIATK": "Teknoloji", "REEDR": "Teknoloji", "ARDYZ": "Teknoloji",
    "CIMSA": "Çimento", "AKCNS": "Çimento", "OYAKC": "Çimento",
    # GYO (REIT)
    "EKGYO": "GYO", "ISGYO": "GYO", "TRGYO": "GYO", "HLGYO": "GYO", "AKFGY": "GYO",
    # İnşaat
    "ENKAI": "İnşaat",
    # Madencilik
    "KOZAL": "Madencilik", "KOZAA": "Madencilik",
    # Telekomünikasyon
    "TCELL": "Telekomünikasyon", "TTKOM": "Telekomünikasyon",
}


def get_sector(ticker: str) -> str:
    """Helper to return mapped BIST sector for a ticker."""
    return SECTOR_MAP.get(ticker, "Mali" if any(x in ticker for x in ["FN", "BKO", "GR", "IS"]) else "Sınai")
