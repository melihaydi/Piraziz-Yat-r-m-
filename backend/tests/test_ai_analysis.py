import pytest
from unittest.mock import MagicMock, patch
from app.services.ai_analysis import AIAnalysisService

@patch("httpx.post")
@patch("app.services.ai_analysis.settings")
def test_analyze_financials_gemini_success(mock_settings, mock_post):
    # Setup key and mock response
    mock_settings.GEMINI_API_KEY = "mock_key"
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": '{"executive_summary": "Summary", "long_comment": "Comment", "short_summary": "Short", "strengths": ["S1"], "weaknesses": ["W1"], "risks": ["R1"], "opportunities": ["O1"]}'
                        }
                    ]
                }
            }
        ]
    }
    mock_post.return_value = mock_response

    service = AIAnalysisService()
    result = service.analyze_financials(
        ticker="THYAO",
        current_data={"sales": 1000, "ebitda": 200, "net_profit": 150, "cash": 50, "total_debt": 100},
        previous_data={"sales": 900, "ebitda": 180, "net_profit": 130}
    )

    assert result["executive_summary"] == "Summary"
    assert result["strengths"] == ["S1"]
    assert result["risks"] == ["R1"]
    mock_post.assert_called_once()

def test_analyze_financials_fallback_rules():
    # Force fallback by keeping GEMINI_API_KEY empty
    service = AIAnalysisService()
    service.api_key = None

    # Positive growth + good debt case
    result_positive = service.analyze_financials(
        ticker="THYAO",
        current_data={"sales": 1000, "ebitda": 200, "net_profit": 150, "cash": 50, "total_debt": 100},
        previous_data={"sales": 800, "ebitda": 150, "net_profit": 100}
    )

    assert "sales" in result_positive["executive_summary"] or "satış" in result_positive["executive_summary"].lower()
    # Check that high sales growth is classified as strength
    assert any("satışlar" in s.lower() for s in result_positive["strengths"])
    
    # Negative growth + high debt case
    result_negative = service.analyze_financials(
        ticker="SASA",
        current_data={"sales": 500, "ebitda": 50, "net_profit": 10, "cash": 10, "total_debt": 300},
        previous_data={"sales": 600, "ebitda": 80, "net_profit": 30}
    )
    # Check that negative growth is classified as weakness
    assert any("satış" in w.lower() for w in result_negative["weaknesses"])
    # Check that high debt/ebitda is classified as weakness
    assert any("borç" in w.lower() for w in result_negative["weaknesses"])

@patch("httpx.post")
@patch("app.services.ai_analysis.settings")
def test_analyze_kap_gemini_success(mock_settings, mock_post):
    mock_settings.GEMINI_API_KEY = "mock_key"
    
    mock_response = MagicMock()
    mock_response.status_code = 200
    mock_response.json.return_value = {
        "candidates": [
            {
                "content": {
                    "parts": [
                        {
                            "text": '{"summary": "KAP Summary", "importance": "high", "affected_financial_lines": ["Net Sales"], "short_term_impact": "Positive", "long_term_impact": "Positive", "sentiment": "positive", "impact_score": 90}'
                        }
                    ]
                }
            }
        ]
    }
    mock_post.return_value = mock_response

    service = AIAnalysisService()
    result = service.analyze_kap_announcement("THYAO", "New Flight Route", "THY launches flights to New York")

    assert result["summary"] == "KAP Summary"
    assert result["sentiment"] == "positive"
    assert result["impact_score"] == 90
    mock_post.assert_called_once()

def test_analyze_kap_fallback_rules():
    service = AIAnalysisService()
    service.api_key = None

    # Positive keyword
    res_pos = service.analyze_kap_announcement("EREGL", "Yeni İhale Kazanılması Hakkında", "Şirketimiz ihaleyi kazanmıştır.")
    assert res_pos["sentiment"] == "positive"
    assert res_pos["impact_score"] == 80

    # Negative keyword
    res_neg = service.analyze_kap_announcement("EREGL", "Vergi Cezası Tebliği", "Şirketimize ceza tebliğ edilmiştir.")
    assert res_neg["sentiment"] == "negative"
    assert res_neg["impact_score"] == 25
