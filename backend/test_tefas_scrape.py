import requests
import re

def test_scrape(code):
    url = f"https://www.tefas.gov.tr/FonAnaliz.aspx?FonKod={code}"
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    }
    try:
        res = requests.get(url, headers=headers, timeout=10)
        body = res.text
        print(f"HTML Length: {len(body)}")
        
        # Find all spans with values
        spans = re.findall(r'<span[^>]*>.*?</span>', body, re.IGNORECASE)
        print(f"Found {len(spans)} spans")
        for s in spans[:20]:
            print(s)
            
        # Let's search for "Fiyat" in spans
        for s in spans:
            if "fiyat" in s.lower() or "price" in s.lower() or "fiyatı" in s.lower():
                print("Matched:", s)
    except Exception as e:
        print(f"Error: {e}")

test_scrape("PHE")
