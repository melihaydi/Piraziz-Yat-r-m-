import datetime
from pytefas import Crawler

def test_returns():
    crawler = Crawler()
    
    dates = []
    for i in range(1, 10):
        d = datetime.date.today() - datetime.timedelta(days=i)
        if d.weekday() < 5:
            dates.append(d.strftime("%Y-%m-%d"))
            if len(dates) == 2:
                break
                
    if len(dates) < 2:
        print("Could not find 2 business days.")
        return
        
    print(f"Dates to query: {dates[0]} and {dates[1]}")
    
    try:
        df1 = crawler.fetch(dates[0], columns="info", kind="YAT")
        df2 = crawler.fetch(dates[1], columns="info", kind="YAT")
        
        codes = ["PHE", "PBR", "DFI", "TLY", "TMV", "PUK"]
        
        for code in codes:
            row1 = df1[df1["fund_code"] == code]
            row2 = df2[df2["fund_code"] == code]
            
            if not row1.empty and not row2.empty:
                p1 = float(row1.iloc[0]["price"])
                p2 = float(row2.iloc[0]["price"])
                ret = ((p1 - p2) / p2) * 100
                print(f"Code: {code} | Price: {p1:.6f} | Prev: {p2:.6f} | Return: {ret:+.4f}%")
            else:
                print(f"Code: {code} | Missing (row1_empty={row1.empty}, row2_empty={row2.empty})")
    except Exception as e:
        print("Error:", e)

test_returns()
