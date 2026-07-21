import datetime

def test_pytefas():
    from pytefas import Crawler
    crawler = Crawler()
    
    df = None
    for i in range(1, 6):
        date_to_try = (datetime.date.today() - datetime.timedelta(days=i))
        if date_to_try.weekday() >= 5:
            continue
            
        date_str = date_to_try.strftime("%Y-%m-%d")
        print(f"Trying date: {date_str}")
        try:
            df = crawler.fetch(date_str, columns="info", kind="YAT")
            if df is not None and not df.empty and "fund_code" in df.columns:
                print(f"SUCCESS loading date: {date_str}")
                break
        except Exception as e:
            print(f"Failed for {date_str}: {e}")
            
    if df is not None:
        codes = ["PHE", "PBR", "DFI", "TLY", "TMV", "PUK"]
        matched = df[df["fund_code"].isin(codes)]
        print(f"Matched count: {len(matched)}")
        for idx, row in matched.iterrows():
            print(f"Code: {row['fund_code']}, Name: {row['fund_name'][:30]}, Price: {row['price']}")
    else:
        print("Could not load any data from last 5 days.")

test_pytefas()
