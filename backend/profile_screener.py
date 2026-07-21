import time
from app.services.market_data import market_data_service
from app.api.v1.endpoints.screener import get_screener_stocks

def profile():
    t0 = time.time()
    
    # Measure time to get all cached quotes
    t_quotes_start = time.time()
    cached_quotes = market_data_service.get_all_quotes()
    t_quotes_end = time.time()
    print(f"get_all_quotes took: {t_quotes_end - t_quotes_start:.6f}s")
    
    # Run the actual screener method
    t_screener_start = time.time()
    res = get_screener_stocks()
    t_screener_end = time.time()
    print(f"get_screener_stocks method took: {t_screener_end - t_screener_start:.6f}s")
    print(f"Returned {len(res)} items")

profile()
