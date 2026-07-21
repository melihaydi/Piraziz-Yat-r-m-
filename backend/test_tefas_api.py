import requests

def test_api():
    headers = {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Referer": "https://www.tefas.gov.tr/TarihselVeriler.aspx",
        "Origin": "https://www.tefas.gov.tr",
        "Accept": "application/json, text/javascript, */*; q=0.01",
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        "X-Requested-With": "XMLHttpRequest"
    }
    
    session = requests.Session()
    session.headers.update(headers)
    
    # 1. Visit main page to get cookies
    try:
        r1 = session.get("https://www.tefas.gov.tr/TarihselVeriler.aspx", timeout=10)
        print("TarihselVeriler Page Loaded. Status:", r1.status_code)
    except Exception as e:
        print("Error visiting page:", e)
        return

    # 2. Let's try calling BindHistoryData
    try:
        # Note: the TEFAS endpoint usually takes POST parameters:
        # e.g., {'startDate': '20.07.2026', 'endDate': '21.07.2026', 'fontype': 'YAT'}
        # Let's try the parameters from eneshenderson/Tefas-API or pytefas
        # In eneshenderson/Tefas-API:
        # data = {
        #     "draw": 1,
        #     "start": 0,
        #     "length": 1000,
        #     "fontype": "YAT",
        #     "grupcode": "",
        #     "order[0][column]": 0,
        #     "order[0][dir]": "asc"
        # }
        # URL: https://www.tefas.gov.tr/api/DB/BindFonBilgileri.ashx
        data = {
            "draw": "1",
            "start": "0",
            "length": "2000",
            "fontype": "YAT"
        }
        res = session.post("https://www.tefas.gov.tr/api/DB/BindFonBilgileri.ashx", data=data, timeout=10)
        print("BindFonBilgileri Status:", res.status_code)
        text = res.text
        print("Length:", len(text))
        if len(text) > 0:
            print("Response preview:", text[:500])
            # Parse for PHE, PBR etc.
            if "PHE" in text:
                print("SUCCESS! PHE IS IN RESPONSE!")
    except Exception as e:
        print("Error BindFonBilgileri:", e)

test_api()
