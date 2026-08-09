import io
from datetime import date, datetime
from typing import Optional

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import cm
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle
from sqlalchemy.orm import Session

from app.models.trade import TradeAccount, TradeOrder
from app.services import trade_service


def generate_account_statement_pdf(
    db: Session,
    account: TradeAccount,
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
) -> bytes:
    """Renders a PDF account statement: account summary, performance stats,
    and the order history for the given period (defaults to all-time).
    Pure informational document for a simulated paper-trading account -
    NOT an official brokerage statement or tax document, this is stated
    explicitly in the PDF's own footer (see trade_service.get_tax_report's
    docstring for the same reasoning applied there)."""
    query = db.query(TradeOrder).filter(TradeOrder.account_id == account.id)
    if from_date:
        query = query.filter(TradeOrder.executed_at >= datetime.combine(from_date, datetime.min.time()))
    if to_date:
        query = query.filter(TradeOrder.executed_at <= datetime.combine(to_date, datetime.max.time()))
    orders = query.order_by(TradeOrder.executed_at.asc()).all()

    performance = trade_service.get_performance(db, account)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer, pagesize=A4,
        topMargin=2 * cm, bottomMargin=2 * cm, leftMargin=1.8 * cm, rightMargin=1.8 * cm,
    )
    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("TitleTr", parent=styles["Title"], fontSize=18, spaceAfter=4)
    small = ParagraphStyle("Small", parent=styles["Normal"], fontSize=8, textColor=colors.grey)

    period_label = (
        f"{from_date.isoformat() if from_date else 'Başlangıç'} - {to_date.isoformat() if to_date else 'Bugün'}"
    )

    elements = [
        Paragraph("Piraziz Yatırım - Hesap Ekstresi", title_style),
        Paragraph(f"Hesap: {account.name} ({account.broker})", styles["Normal"]),
        Paragraph(f"Dönem: {period_label}", styles["Normal"]),
        Paragraph(f"Oluşturulma: {datetime.now().strftime('%d.%m.%Y %H:%M')}", styles["Normal"]),
        Spacer(1, 0.6 * cm),
    ]

    summary_data = [
        ["Başlangıç Bakiyesi", f"₺{account.starting_balance:,.2f}"],
        ["Güncel Nakit", f"₺{account.cash_balance:,.2f}"],
        ["Gerçekleşen K/Z", f"₺{performance['realized_pnl']:,.2f}"],
        ["Gerçekleşmemiş K/Z", f"₺{performance['unrealized_pnl']:,.2f}"],
        ["Kazanma Oranı", f"%{performance['win_rate_pct']:.1f}"],
        ["Toplam İşlem", str(performance["total_trades"])],
        ["Maks. Düşüş (Drawdown)", f"%{performance['max_drawdown_pct']:.1f}"],
    ]
    summary_table = Table(summary_data, colWidths=[7 * cm, 7 * cm])
    summary_table.setStyle(TableStyle([
        ("FONTSIZE", (0, 0), (-1, -1), 9),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("TEXTCOLOR", (0, 0), (0, -1), colors.grey),
        ("FONTNAME", (1, 0), (1, -1), "Helvetica-Bold"),
        ("LINEBELOW", (0, 0), (-1, -1), 0.5, colors.HexColor("#e5e5e5")),
    ]))
    elements.append(summary_table)
    elements.append(Spacer(1, 0.8 * cm))

    elements.append(Paragraph(f"İşlem Dökümü ({len(orders)} işlem)", styles["Heading2"]))
    elements.append(Spacer(1, 0.2 * cm))

    if orders:
        rows = [["Tarih", "Sembol", "Yön", "Lot", "Fiyat", "Toplam", "K/Z"]]
        for o in orders:
            rows.append([
                o.executed_at.strftime("%d.%m.%Y %H:%M") if o.executed_at else "-",
                o.symbol,
                o.side,
                f"{o.lot:g}",
                f"₺{o.price:,.2f}",
                f"₺{o.total:,.2f}",
                f"₺{o.realized_pnl:,.2f}" if o.realized_pnl is not None else "-",
            ])
        order_table = Table(rows, colWidths=[3.2 * cm, 2.3 * cm, 1.5 * cm, 1.5 * cm, 2.5 * cm, 2.7 * cm, 2.5 * cm], repeatRows=1)
        order_table.setStyle(TableStyle([
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e1e2e")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#dddddd")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#f7f7fa")]),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
            ("TOPPADDING", (0, 0), (-1, -1), 3),
        ]))
        elements.append(order_table)
    else:
        elements.append(Paragraph("Bu dönemde işlem bulunmuyor.", styles["Normal"]))

    elements.append(Spacer(1, 1 * cm))
    elements.append(Paragraph(
        "Bu belge, Piraziz Yatırım'ın simüle (kağıt üzerinde) alım-satım hesabı için üretilmiş "
        "bilgilendirme amaçlı bir dökümdür. Resmi bir aracı kurum hesap ekstresi veya vergi belgesi "
        "değildir; gerçek para/gerçek borsa işlemi içermez.",
        small,
    ))

    doc.build(elements)
    return buffer.getvalue()
