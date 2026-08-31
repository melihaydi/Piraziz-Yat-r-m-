from datetime import date, datetime, timedelta, timezone
from unittest.mock import patch, MagicMock

import pytest

from app.models.telegram_link import TelegramLink
from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot
from app.models.kap import KapNotification
from app.services import telegram_bot


# --- get_or_create_link / regenerate_link_code ------------------------------

def test_get_or_create_link_creates_new_link_with_valid_code(db):
    link = telegram_bot.get_or_create_link(db, user_id=1)
    assert link.user_id == 1
    assert link.chat_id is None
    assert link.linked_at is None
    assert link.daily_digest_enabled is True
    assert len(link.link_code) == 8


def test_get_or_create_link_returns_same_link_on_second_call(db):
    first = telegram_bot.get_or_create_link(db, user_id=1)
    second = telegram_bot.get_or_create_link(db, user_id=1)
    assert first.id == second.id
    assert first.link_code == second.link_code


def test_regenerate_link_code_resets_code_and_clears_chat(db):
    link = telegram_bot.get_or_create_link(db, user_id=1)
    old_code = link.link_code
    link.chat_id = "12345"
    link.linked_at = datetime.now(timezone.utc)
    db.commit()

    updated = telegram_bot.regenerate_link_code(db, link)
    assert updated.link_code != old_code
    assert updated.chat_id is None
    assert updated.linked_at is None


# --- _handle_update ----------------------------------------------------------

def _fake_update(text, chat_id=999):
    return {"update_id": 1, "message": {"text": text, "chat": {"id": chat_id}}}


def test_handle_update_links_chat_id_on_valid_code(db):
    link = telegram_bot.get_or_create_link(db, user_id=1)
    with patch("app.services.telegram_bot._send_message", return_value=True):
        telegram_bot._handle_update(db, _fake_update(f"/start {link.link_code}", chat_id=555))
    # _handle_update kendi başına commit ETMEZ - poll_updates() tüm
    # update'leri işledikten sonra tek seferde commit ediyor (bkz. o
    # fonksiyonun kendi testi). Burada da aynı sözleşmeyi taklit ediyoruz.
    db.commit()
    db.refresh(link)
    assert link.chat_id == "555"
    assert link.linked_at is not None


def test_handle_update_ignores_unknown_code(db):
    link = telegram_bot.get_or_create_link(db, user_id=1)
    with patch("app.services.telegram_bot._send_message", return_value=True) as mock_send:
        telegram_bot._handle_update(db, _fake_update("/start NOTREAL01", chat_id=555))
        mock_send.assert_called_once()
        assert "tanınmadı" in mock_send.call_args[0][1]
    db.refresh(link)
    assert link.chat_id is None


def test_handle_update_bare_start_prompts_for_code(db):
    with patch("app.services.telegram_bot._send_message", return_value=True) as mock_send:
        telegram_bot._handle_update(db, _fake_update("/start"))
        mock_send.assert_called_once()
        assert "Ayarlar" in mock_send.call_args[0][1]


def test_handle_update_ignores_non_start_messages(db):
    with patch("app.services.telegram_bot._send_message") as mock_send:
        telegram_bot._handle_update(db, _fake_update("merhaba"))
        mock_send.assert_not_called()


def test_handle_update_ignores_message_without_chat(db):
    update = {"update_id": 1, "message": {"text": "/start ABCD1234"}}
    with patch("app.services.telegram_bot._send_message") as mock_send:
        telegram_bot._handle_update(db, update)
        mock_send.assert_not_called()


# --- compute_digest_text ------------------------------------------------------

def _portfolio_with_asset(db, user_id, ticker="THYAO", shares=10.0, cost=300.0):
    portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
    db.add(portfolio)
    db.flush()
    db.add(PortfolioAsset(portfolio_id=portfolio.id, ticker=ticker, shares=shares, average_cost=cost))
    db.commit()
    return portfolio


def test_compute_digest_text_none_when_no_assets(db):
    assert telegram_bot.compute_digest_text(db, user_id=1) is None


def test_compute_digest_text_includes_yesterdays_change(db):
    _portfolio_with_asset(db, user_id=1)
    today = date.today()
    db.add(PortfolioSnapshot(user_id=1, snapshot_date=today - timedelta(days=1), total_value=10000.0))
    db.add(PortfolioSnapshot(user_id=1, snapshot_date=today, total_value=10500.0))
    db.commit()

    with patch("app.services.telegram_bot.tefas_order_cutoff_info", return_value={"same_day": False}):
        text = telegram_bot.compute_digest_text(db, user_id=1)

    assert "+5.00%" in text
    assert "10,500" in text


def test_compute_digest_text_includes_recent_kap_notice_for_held_ticker(db):
    _portfolio_with_asset(db, user_id=1, ticker="THYAO")
    db.add(KapNotification(
        id="kap-recent", ticker="THYAO", title="THYAO yeni uçak siparişi",
        publish_date=datetime.now(timezone.utc) - timedelta(hours=2),
    ))
    db.commit()

    with patch("app.services.telegram_bot.tefas_order_cutoff_info", return_value={"same_day": False}):
        text = telegram_bot.compute_digest_text(db, user_id=1)

    assert "THYAO yeni uçak siparişi" in text


def test_compute_digest_text_excludes_kap_notice_older_than_24h(db):
    _portfolio_with_asset(db, user_id=1, ticker="THYAO")
    db.add(KapNotification(
        id="kap-old", ticker="THYAO", title="Eski bildirim",
        publish_date=datetime.now(timezone.utc) - timedelta(hours=30),
    ))
    db.commit()

    with patch("app.services.telegram_bot.tefas_order_cutoff_info", return_value={"same_day": False}):
        text = telegram_bot.compute_digest_text(db, user_id=1)

    assert "Eski bildirim" not in text


def test_compute_digest_text_includes_cutoff_reminder_for_fund_holder(db):
    _portfolio_with_asset(db, user_id=1, ticker="PHE")
    with patch("app.services.telegram_bot.tefas_order_cutoff_info", return_value={"same_day": True, "cutoff_time": "13:30"}):
        text = telegram_bot.compute_digest_text(db, user_id=1)
    assert "13:30" in text


def test_compute_digest_text_no_cutoff_reminder_for_stock_only_portfolio(db):
    _portfolio_with_asset(db, user_id=1, ticker="THYAO")
    with patch("app.services.telegram_bot.tefas_order_cutoff_info") as mock_cutoff:
        telegram_bot.compute_digest_text(db, user_id=1)
        mock_cutoff.assert_not_called()


# --- poll_updates / send_morning_digest --------------------------------------

def test_poll_updates_noop_without_bot_token():
    with patch("app.services.telegram_bot.settings.TELEGRAM_BOT_TOKEN", None), \
         patch("httpx.get") as mock_get:
        telegram_bot.poll_updates()
        mock_get.assert_not_called()


def test_poll_updates_processes_and_caches_offset(db):
    fake_response = MagicMock()
    fake_response.json.return_value = {"result": [
        {"update_id": 42, "message": {"text": "/start XXXXXXXX", "chat": {"id": 1}}}
    ]}
    fake_response.raise_for_status.return_value = None

    with patch("app.services.telegram_bot.settings.TELEGRAM_BOT_TOKEN", "fake-token"), \
         patch("app.services.telegram_bot.SessionLocal", return_value=db), \
         patch("httpx.get", return_value=fake_response), \
         patch("app.services.telegram_bot._send_message", return_value=True), \
         patch("app.services.telegram_bot.cache_service.set_json") as mock_set:
        telegram_bot.poll_updates()

    # assert_called_once DEĞİL: bu servisin gerçek arka plan poll_loop
    # thread'i (main.py'nin startup event'inde başlıyor) test paketi
    # boyunca zaten çalışıyor - settings.TELEGRAM_BOT_TOKEN'ı yukarıda
    # geçici olarak patch'lemek O thread'in de aynı anda görebileceği
    # PAYLAŞILAN bir global, yani nadiren o thread de bu pencerede
    # poll_updates()'e girip set_json'ı bir kere daha (AYNI, idempotent
    # değerle) çağırabilir - gerçek üretimde TELEGRAM_BOT_TOKEN süreç
    # boyunca sabit olduğu için bu yarış hiç oluşmaz, sadece testin kendi
    # patch'lemesinin yan etkisi. Asıl doğrulanması gereken şey zaten en
    # az bir kere DOĞRU offset'le çağrıldığı, kaç kere çağrıldığı değil.
    assert mock_set.called
    assert mock_set.call_args[0][1] == 43  # last update_id + 1


def test_send_morning_digest_only_messages_enabled_linked_users(db):
    linked_enabled = telegram_bot.get_or_create_link(db, user_id=1)
    linked_enabled.chat_id = "111"
    _portfolio_with_asset(db, user_id=1, ticker="THYAO")

    linked_disabled = telegram_bot.get_or_create_link(db, user_id=2)
    linked_disabled.chat_id = "222"
    linked_disabled.daily_digest_enabled = False
    _portfolio_with_asset(db, user_id=2, ticker="GARAN")

    unlinked = telegram_bot.get_or_create_link(db, user_id=3)
    _portfolio_with_asset(db, user_id=3, ticker="AKBNK")

    db.commit()

    with patch("app.services.telegram_bot.SessionLocal", return_value=db), \
         patch("app.services.telegram_bot.tefas_order_cutoff_info", return_value={"same_day": False}), \
         patch("app.services.telegram_bot._send_message", return_value=True) as mock_send:
        telegram_bot.send_morning_digest()

    sent_to = [call.args[0] for call in mock_send.call_args_list]
    assert sent_to == ["111"]
