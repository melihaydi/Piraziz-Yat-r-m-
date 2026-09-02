"""Yeniden bağlanırken TradingView auth_token'ın tazelenmesi.

Neden önemli: token dosyası cron ile 3 saatte bir yenileniyor ama süreç
onu yalnızca başlangıçta okuyordu. Bayat token'la TradingView bağlantıyı
hemen kapatıyor ve aynı ölü token her denemede yeniden sunulduğu için
flap döngüsü kendini besliyordu. Artık her yeniden bağlanmada dosya
tekrar okunuyor - bu testler o davranışın kaybolmadığını garanti ediyor.
"""
from unittest.mock import patch

from app.services import market_data as md


class _FakeStream:
    def __init__(self, token=None):
        self._auth_token = token
        self._flap_attempts = 0
        self._flap_connected_at = None
        self.started = 0

    def _start_websocket(self):
        self.started += 1


def test_reconnect_picks_up_refreshed_token():
    stream = _FakeStream(token="ESKI_TOKEN")
    with patch.object(md, "read_auth_token_file", return_value="YENI_TOKEN"), \
         patch.object(md.time, "sleep"):
        md.patched_reconnect(stream)

    assert stream._auth_token == "YENI_TOKEN"
    assert stream.started == 1


def test_reconnect_keeps_token_when_file_unchanged():
    stream = _FakeStream(token="AYNI")
    with patch.object(md, "read_auth_token_file", return_value="AYNI"), \
         patch.object(md.time, "sleep"):
        md.patched_reconnect(stream)

    assert stream._auth_token == "AYNI"
    assert stream.started == 1


def test_reconnect_keeps_existing_token_when_file_missing():
    """Yerel geliştirmede token dosyası yok - mevcut token SİLİNMEMELİ,
    yoksa çalışan bir bağlantı dosya yok diye kimliksiz kalırdı."""
    stream = _FakeStream(token="MEVCUT")
    with patch.object(md, "read_auth_token_file", return_value=None), \
         patch.object(md.time, "sleep"):
        md.patched_reconnect(stream)

    assert stream._auth_token == "MEVCUT"
    assert stream.started == 1


def test_reconnect_still_backs_off():
    """Token tazeleme, mevcut backoff davranışını bozmamalı."""
    stream = _FakeStream(token="T")
    with patch.object(md, "read_auth_token_file", return_value="T"), \
         patch.object(md.time, "sleep") as mock_sleep:
        md.patched_reconnect(stream)   # attempt 0 -> 1s
        md.patched_reconnect(stream)   # attempt 1 -> 2s
        md.patched_reconnect(stream)   # attempt 2 -> 4s

    assert [c.args[0] for c in mock_sleep.call_args_list] == [1, 2, 4]
