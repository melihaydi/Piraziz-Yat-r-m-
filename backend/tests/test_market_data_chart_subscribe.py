import threading
import time

from app.services.market_data import patched_subscribe_chart


class _FakeStream:
    """Minimal stand-in for TradingViewStream exposing only what
    patched_subscribe_chart touches. Records the exact order of WebSocket
    sends so an interleaving between two concurrent subscribers is
    detectable."""

    def __init__(self):
        self._lock = threading.RLock()
        self._chart_subscribed = {}
        self._chart_series_map = {}
        self._chart_data = {}
        self._chart_series_counter = 0
        self._chart_session = "cs_test"
        self.is_connected = True
        self.sent = []
        self._sent_lock = threading.Lock()
        # Set by the test to widen the window between two sends, so a second
        # thread deterministically gets scheduled in the middle of the first
        # thread's resolve_symbol -> create_series pair.
        self.stall_after_resolve = 0.0

    def _create_message(self, method, params):
        return (method, params)

    def _send(self, message):
        with self._sent_lock:
            self.sent.append(message)
        if message[0] == "resolve_symbol" and self.stall_after_resolve:
            time.sleep(self.stall_after_resolve)
        return True


def _assert_no_interleaving(stream):
    """Every resolve_symbol must be immediately followed by a create_series
    carrying the SAME series_id. That adjacency is precisely what the race
    used to break."""
    for i, (method, params) in enumerate(stream.sent):
        if method != "resolve_symbol":
            continue
        resolved_series_id = params[1]
        assert i + 1 < len(stream.sent), "resolve_symbol had no following send"
        next_method, next_params = stream.sent[i + 1]
        assert next_method == "create_series", (
            f"resolve_symbol({resolved_series_id}) was followed by "
            f"{next_method}, not create_series - the sends interleaved"
        )
        assert next_params[3] == resolved_series_id, (
            f"create_series used series_id {next_params[3]} but the "
            f"preceding resolve_symbol was for {resolved_series_id}"
        )


def test_concurrent_chart_subscribes_do_not_interleave():
    # Regression test: patched_subscribe_chart used to hold self._lock only
    # for its bookkeeping, then release it before sending remove_series /
    # resolve_symbol / create_series. Those sends are a read-modify-write
    # against ONE shared remote chart session ($prices/s1), and several
    # callers fetch candles concurrently (portfolio/strategy/screener all
    # use ThreadPoolExecutor). With the lock released early their sends
    # interleaved: one thread's clear()+remove_series invalidated the
    # series_id another thread was about to create_series with. TradingView
    # rejected those with "invalid symbol"/"resolve error" - 1308 symbol
    # errors + 181 series errors in a single 15-minute production window
    # (~87/min of pure wasted work on a 1GB host).
    #
    # stall_after_resolve holds each thread inside the critical section long
    # enough that, without the lock covering the sends, a second thread is
    # guaranteed to interleave - making this test deterministic rather than
    # dependent on lucky scheduling.
    stream = _FakeStream()
    stream.stall_after_resolve = 0.05

    threads = [
        threading.Thread(
            target=patched_subscribe_chart, args=(stream, sym, "1d"), name=f"t-{sym}"
        )
        for sym in ("THYAO", "GARAN", "AKBNK", "ASELS")
    ]
    for t in threads:
        t.start()
    for t in threads:
        t.join()

    _assert_no_interleaving(stream)


def test_chart_subscribe_records_symbol_in_series_map():
    stream = _FakeStream()
    patched_subscribe_chart(stream, "thyao", "1d")

    assert stream._chart_subscribed == {"THYAO": {"1d"}}
    assert list(stream._chart_series_map.values()) == [("THYAO", "1d")]
