"""回测报告导出：Excel 和 PDF 生成。"""

import os
import io
import sys
import traceback

# ---------- 中文字体辅助 ----------

def _find_chinese_font():
    """在 Windows / Linux / macOS 上查找可用的中文字体路径。"""
    if sys.platform == 'win32':
        candidates = [
            "C:/Windows/Fonts/simhei.ttf",
            "C:/Windows/Fonts/msyh.ttc",
            "C:/Windows/Fonts/msyhbd.ttc",
            "C:/Windows/Fonts/simsun.ttc",
            "C:/Windows/Fonts/simkai.ttf",
        ]
    elif sys.platform == 'darwin':
        candidates = [
            "/System/Library/Fonts/PingFang.ttc",
            "/System/Library/Fonts/STHeiti Light.ttc",
            "/System/Library/Fonts/Hiragino Sans GB.ttc",
            "/Library/Fonts/Arial Unicode.ttf",
        ]
    else:
        candidates = [
            "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
            "/usr/share/fonts/truetype/wqy/wqy-microhei.ttc",
            "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
            "/usr/share/fonts/truetype/droid/DroidSansFallbackFull.ttf",
        ]
    for path in candidates:
        if os.path.exists(path):
            return path
    return None


def _register_chinese_font():
    """向 reportlab 注册中文字体，返回字体名称。"""
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    font_path = _find_chinese_font()
    if font_path:
        try:
            pdfmetrics.registerFont(TTFont('ChineseFont', font_path))
            return 'ChineseFont'
        except Exception:
            pass
    # 回退：尝试使用内置字体（中文会显示为方块）
    return 'Helvetica'


# ---------- Excel 导出 ----------

def export_to_excel(data, filepath):
    """使用 xlsxwriter 引擎生成多工作表 Excel 报告（高性能）。"""
    import pandas as pd

    with pd.ExcelWriter(filepath, engine='xlsxwriter') as writer:
        workbook = writer.book

        # 通用格式
        header_fmt = workbook.add_format({
            'font_name': 'Microsoft YaHei', 'font_size': 11, 'bold': True,
            'font_color': '#FFFFFF', 'bg_color': '#4F7EFF',
            'align': 'center', 'valign': 'vcenter',
            'border': 1, 'border_color': '#D0D0D0',
        })
        cell_fmt = workbook.add_format({
            'font_name': 'Microsoft YaHei', 'font_size': 10,
            'align': 'center', 'valign': 'vcenter',
            'border': 1, 'border_color': '#D0D0D0',
        })

        def write_styled_sheet(ws, df, col_widths):
            """将 DataFrame 写入工作表并应用样式。"""
            for col_idx, col_name in enumerate(df.columns):
                ws.write(0, col_idx, col_name, header_fmt)
            for row_idx in range(len(df)):
                for col_idx in range(len(df.columns)):
                    val = df.iloc[row_idx, col_idx]
                    if isinstance(val, float) and (pd.isna(val) or abs(val) > 1e10):
                        val = ''
                    ws.write(row_idx + 1, col_idx, val, cell_fmt)
            for col_idx, w in enumerate(col_widths):
                ws.set_column(col_idx, col_idx, w)
            ws.freeze_panes(1, 0)

        # --- Sheet 1: 绩效指标 ---
        metrics = data.get('metrics', {})
        metric_labels = [
            ('total_return', '累计收益率 (%)'),
            ('annual_return', '年化收益率 (%)'),
            ('max_drawdown', '最大回撤 (%)'),
            ('max_drawdown_duration', '最大回撤持续 (天)'),
            ('sharpe_ratio', '夏普比率'),
            ('annual_volatility', '年化波动率 (%)'),
            ('information_ratio', '信息比率'),
            ('win_rate', '胜率 (%)'),
            ('total_trades', '总交易次数'),
        ]
        rows = []
        for key, label in metric_labels:
            value = metrics.get(key, '--')
            if isinstance(value, (int, float)):
                value = round(value, 2)
            else:
                value = str(value)
            rows.append([label, value])

        # 策略概要
        rows.append(['', ''])
        rows.append(['策略名称', data.get('strategyName', '')])
        rows.append(['回测区间', f"{data.get('periodStart', '')} ~ {data.get('periodEnd', '')}"])

        df_metrics = pd.DataFrame(rows, columns=['指标', '数值'])
        df_metrics.to_excel(writer, sheet_name='绩效指标', index=False, header=False)
        ws = writer.sheets['绩效指标']
        write_styled_sheet(ws, df_metrics, [22, 18])

        # --- Sheet 2: 权益曲线 ---
        equity_curve = data.get('equityCurve', [])
        eq_rows = [[str(pt.get('date', '')), pt.get('value', 0)] for pt in equity_curve]
        df_equity = pd.DataFrame(eq_rows, columns=['日期', '权益 (元)'])
        df_equity.to_excel(writer, sheet_name='权益曲线', index=False, header=False)
        ws_eq = writer.sheets['权益曲线']
        write_styled_sheet(ws_eq, df_equity, [16, 18])

        # --- Sheet 3: 交易信号 ---
        signals = data.get('signals', [])
        max_signals = min(len(signals), 2000)
        sig_rows = []
        for i in range(max_signals):
            sig = signals[i]
            sig_type = sig.get('type', '')
            sig_type_cn = '买入' if sig_type == 'buy' else ('卖出' if sig_type == 'sell' else sig_type)
            sig_rows.append([
                str(sig.get('date', '')),
                str(sig.get('code', '')),
                sig_type_cn,
                sig.get('price', 0),
                int(sig.get('shares', 0) / 100),
                str(sig.get('reason', '')),
            ])
        df_signals = pd.DataFrame(sig_rows, columns=['日期', '股票代码', '类型', '价格', '手数', '原因'])
        df_signals.to_excel(writer, sheet_name='交易信号', index=False, header=False)
        ws_sig = writer.sheets['交易信号']
        write_styled_sheet(ws_sig, df_signals, [14, 12, 8, 12, 10, 30])

        # --- Sheet 4: 股票绩效 ---
        stock_perf = data.get('stockPerformance', [])
        perf_rows = []
        for sp in stock_perf:
            perf_rows.append([
                str(sp.get('code', '')),
                str(sp.get('name', '')),
                sp.get('total_trades', 0),
                round(sp.get('total_profit', 0), 2),
                round(sp.get('win_rate', 0), 2),
                round(sp.get('avg_profit', 0), 2),
            ])
        df_perf = pd.DataFrame(perf_rows, columns=['股票代码', '股票名称', '交易次数', '累计盈亏 (元)', '胜率 (%)', '平均每笔盈亏 (元)'])
        df_perf.to_excel(writer, sheet_name='股票绩效', index=False, header=False)
        ws_perf = writer.sheets['股票绩效']
        write_styled_sheet(ws_perf, df_perf, [12, 14, 12, 16, 12, 20])


# ---------- PDF 导出 ----------

def export_to_pdf(data, filepath):
    """使用 reportlab + matplotlib 生成 PDF 报告。"""
    import matplotlib
    matplotlib.use('Agg')
    import matplotlib.pyplot as plt
    from matplotlib.font_manager import FontProperties
    from reportlab.lib.pagesizes import A4
    from reportlab.lib.units import mm
    from reportlab.lib import colors
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.lib.enums import TA_CENTER, TA_LEFT
    from reportlab.platypus import (SimpleDocTemplate, Paragraph, Spacer,
                                     Table, TableStyle, Image, PageBreak)
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont

    # 注册中文字体
    cn_font_name = _register_chinese_font()
    cn_font_path = _find_chinese_font()

    # 字体设置
    body_font = cn_font_name if cn_font_name != 'Helvetica' else 'Helvetica'

    # 生成权益曲线图
    chart_img = None
    equity_curve = data.get('equityCurve', [])
    if equity_curve and len(equity_curve) > 1:
        dates = [d.get('date', '') for d in equity_curve]
        values = [d.get('value', 0) for d in equity_curve]

        # matplotlib 中文字体
        if cn_font_path:
            zh_font = FontProperties(fname=cn_font_path)
        else:
            zh_font = FontProperties()

        fig, ax = plt.subplots(figsize=(7.2, 3.2))
        ax.plot(range(len(dates)), values, color='#4F7EFF', linewidth=1.2, marker=None)
        ax.fill_between(range(len(dates)), min(values), values, alpha=0.15, color='#4F7EFF')
        ax.set_title('权益曲线', fontproperties=zh_font, fontsize=13)
        ax.set_xlabel('交易日序号', fontproperties=zh_font, fontsize=9)
        ax.set_ylabel('权益 (元)', fontproperties=zh_font, fontsize=9)
        ax.tick_params(labelsize=8)
        ax.grid(True, alpha=0.3)
        ax.set_facecolor('#FAFBFC')
        fig.tight_layout(pad=1.5)

        chart_buf = io.BytesIO()
        fig.savefig(chart_buf, format='png', dpi=120, bbox_inches='tight')
        chart_buf.seek(0)
        plt.close(fig)
        chart_img = chart_buf

    # 构建 PDF
    doc = SimpleDocTemplate(
        filepath, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=14 * mm, bottomMargin=14 * mm,
    )

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle('CNTitle', fontName=body_font, fontSize=16,
                                 leading=22, alignment=TA_CENTER, textColor=colors.HexColor('#1a2540'))
    h2_style = ParagraphStyle('CNH2', fontName=body_font, fontSize=13,
                              leading=18, spaceBefore=12, spaceAfter=6,
                              textColor=colors.HexColor('#4F7EFF'))
    body_style = ParagraphStyle('CNBody', fontName=body_font, fontSize=9,
                                leading=14, textColor=colors.HexColor('#333333'))
    small_style = ParagraphStyle('CNSmall', fontName=body_font, fontSize=8,
                                 leading=11, textColor=colors.HexColor('#666666'))

    story = []

    # 标题
    strategy_name = data.get('strategyName', '未命名策略')
    story.append(Paragraph(f'策略回测报告', title_style))
    story.append(Spacer(1, 4 * mm))
    story.append(Paragraph(f'策略名称：{strategy_name}', small_style))
    story.append(Paragraph(
        f'回测区间：{data.get("periodStart", "--")} ~ {data.get("periodEnd", "--")}',
        small_style))
    story.append(Spacer(1, 8 * mm))

    # 权益曲线图
    if chart_img:
        story.append(Paragraph('权益曲线', h2_style))
        img = Image(chart_img, width=doc.width, height=doc.width * 0.45)
        story.append(img)
        story.append(Spacer(1, 6 * mm))

    # 绩效指标表
    story.append(Paragraph('绩效指标', h2_style))
    metrics = data.get('metrics', {})
    metric_rows = [
        ['指标', '数值'],
        ['累计收益率 (%)', f'{metrics.get("total_return", "--")}'],
        ['年化收益率 (%)', f'{metrics.get("annual_return", "--")}'],
        ['最大回撤 (%)', f'{metrics.get("max_drawdown", "--")}'],
        ['最大回撤持续 (天)', f'{metrics.get("max_drawdown_duration", "--")}'],
        ['夏普比率', f'{metrics.get("sharpe_ratio", "--")}'],
        ['年化波动率 (%)', f'{metrics.get("annual_volatility", "--")}'],
        ['信息比率', f'{metrics.get("information_ratio", "--")}'],
        ['胜率 (%)', f'{metrics.get("win_rate", "--")}'],
        ['总交易次数', f'{metrics.get("total_trades", "--")}'],
    ]
    metric_col_widths = [doc.width * 0.55, doc.width * 0.45]
    metric_table = Table(metric_rows, colWidths=metric_col_widths)
    metric_table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4F7EFF')),
        ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
        ('FONTNAME', (0, 0), (-1, -1), body_font),
        ('FONTSIZE', (0, 0), (-1, -1), 9),
        ('FONTSIZE', (0, 0), (-1, 0), 10),
        ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
        ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
        ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D0D0D0')),
        ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F8FA')]),
        ('TOPPADDING', (0, 0), (-1, -1), 4),
        ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
    ]))
    story.append(metric_table)
    story.append(Spacer(1, 10 * mm))

    # 交易信号表（分页显示全部信号）
    signals = data.get('signals', [])
    if signals:
        story.append(Paragraph(f'交易信号（共 {len(signals)} 条）', h2_style))
        sig_headers = ['日期', '股票', '类型', '价格', '手数', '原因']
        sig_col_widths = [doc.width * 0.16, doc.width * 0.13, doc.width * 0.08,
                          doc.width * 0.13, doc.width * 0.10, doc.width * 0.40]
        rows_per_page = 30
        for page_start in range(0, len(signals), rows_per_page):
            page_data = [sig_headers]
            for sig in signals[page_start:page_start + rows_per_page]:
                sig_type = sig.get('type', '')
                sig_type_cn = '买入' if sig_type == 'buy' else ('卖出' if sig_type == 'sell' else sig_type)
                page_data.append([
                    str(sig.get('date', '')),
                    str(sig.get('code', '')),
                    sig_type_cn,
                    f'{sig.get("price", 0):.2f}',
                    str(int(sig.get('shares', 0) / 100)),
                    str(sig.get('reason', ''))[:20],
                ])
            sig_table = Table(page_data, colWidths=sig_col_widths, repeatRows=1)
            sig_table.setStyle(TableStyle([
                ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4F7EFF')),
                ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
                ('FONTNAME', (0, 0), (-1, -1), body_font),
                ('FONTSIZE', (0, 0), (-1, -1), 7),
                ('FONTSIZE', (0, 0), (-1, 0), 8),
                ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
                ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
                ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D0D0D0')),
                ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F8FA')]),
                ('TOPPADDING', (0, 0), (-1, -1), 2),
                ('BOTTOMPADDING', (0, 0), (-1, -1), 2),
            ]))
            story.append(sig_table)
            if page_start + rows_per_page < len(signals):
                story.append(PageBreak())

    # 股票绩效表
    stock_perf = data.get('stockPerformance', [])
    if stock_perf:
        story.append(Paragraph('股票绩效归因', h2_style))
        perf_data = [['股票代码', '名称', '交易次数', '累计盈亏(元)', '胜率(%)', '平均盈亏(元)']]
        for sp in stock_perf:
            perf_data.append([
                str(sp.get('code', '')),
                str(sp.get('name', '')),
                str(sp.get('total_trades', 0)),
                f'{sp.get("total_profit", 0):.2f}',
                f'{sp.get("win_rate", 0):.2f}',
                f'{sp.get("avg_profit", 0):.2f}',
            ])
        perf_col_widths = [doc.width * 0.14, doc.width * 0.18, doc.width * 0.13,
                           doc.width * 0.20, doc.width * 0.14, doc.width * 0.21]
        perf_table = Table(perf_data, colWidths=perf_col_widths, repeatRows=1)
        perf_table.setStyle(TableStyle([
            ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#4F7EFF')),
            ('TEXTCOLOR', (0, 0), (-1, 0), colors.white),
            ('FONTNAME', (0, 0), (-1, -1), body_font),
            ('FONTSIZE', (0, 0), (-1, -1), 9),
            ('FONTSIZE', (0, 0), (-1, 0), 10),
            ('ALIGN', (0, 0), (-1, -1), 'CENTER'),
            ('VALIGN', (0, 0), (-1, -1), 'MIDDLE'),
            ('GRID', (0, 0), (-1, -1), 0.5, colors.HexColor('#D0D0D0')),
            ('ROWBACKGROUNDS', (0, 1), (-1, -1), [colors.white, colors.HexColor('#F7F8FA')]),
            ('TOPPADDING', (0, 0), (-1, -1), 4),
            ('BOTTOMPADDING', (0, 0), (-1, -1), 4),
        ]))
        story.append(perf_table)

    doc.build(story)

    # 清理图表缓冲区
    if chart_buf:
        chart_buf.close()
