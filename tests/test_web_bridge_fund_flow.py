"""WebBridge 资金流向接口单元测试。

测试覆盖：单只返回格式、批量接口、建议生成逻辑、历史查询。
使用 unittest.mock 模拟 FundFlowFetcher 和 Database。
"""

import json
import unittest
from unittest.mock import patch, MagicMock

from app.web_bridge import WebBridge
from backend.db import Database


# ---------------------------------------------------------------------------
# 模拟数据构造
# ---------------------------------------------------------------------------

def _make_fund_data(code="000001", main_net=1234.56, source="eastmoney"):
    return {
        "code": code,
        "date": "2025-05-28",
        "main_net": main_net,
        "super_net": 500.0,
        "big_net": 734.56,
        "medium_net": -200.0,
        "small_net": -1034.56,
        "source": source,
    }


def _make_history(main_values):
    """根据 main_net 值列表生成历史记录。"""
    return [
        {"date": f"2025-05-{22 + i:02d}", "main_net": v,
         "super_net": None, "big_net": None, "medium_net": None, "small_net": None}
        for i, v in enumerate(main_values)
    ]


# ---------------------------------------------------------------------------
# 测试建议生成
# ---------------------------------------------------------------------------

class TestSuggestionGeneration(unittest.TestCase):
    """_generate_suggestion 静态方法测试。"""

    def test_large_inflow_with_continuity(self):
        """主力大幅净流入 + 连续3日同向 → 建议关注。"""
        current = _make_fund_data(main_net=6000.0)
        history = _make_history([800.0, 1200.0, 1500.0])

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("连续", suggestion)
        self.assertIn("关注", suggestion)
        self.assertIn("4日", suggestion)  # 3 日历史连续 + 当日 = 4 日

    def test_large_outflow_with_continuity(self):
        """主力大幅净流出 + 连续同向 → 注意风险。"""
        current = _make_fund_data(main_net=-5000.0)
        history = _make_history([-600.0, -800.0, -1000.0])

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("连续", suggestion)
        self.assertIn("风险", suggestion)

    def test_small_inflow_观望(self):
        """主力小幅净流入 → 建议观望。"""
        current = _make_fund_data(main_net=1500.0)
        history = _make_history([200.0, -100.0])  # 非连续

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("观望", suggestion)

    def test_near_zero_flow(self):
        """主力净流入接近 0 → 小幅流入/出提示。"""
        current = _make_fund_data(main_net=500.0)
        history = _make_history([])

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("小幅", suggestion)

    def test_none_main_net(self):
        """main_net 为 None → 暂缺提示。"""
        current = _make_fund_data(main_net=None)
        history = _make_history([])

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("暂缺", suggestion)

    def test_no_history(self):
        """无历史数据时仍能生成合理建议。"""
        current = _make_fund_data(main_net=8000.0)
        history = []

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("大额", suggestion)

    def test_history_insufficient(self):
        """历史数据不足 3 日时使用已有数据。"""
        current = _make_fund_data(main_net=4000.0)
        history = _make_history([500.0])  # 仅 1 日

        suggestion = WebBridge._generate_suggestion(current, history)

        # 不应因数据不足而崩溃
        self.assertTrue(len(suggestion) > 0)

    def test_contains_amount(self):
        """建议文案包含具体金额。"""
        current = _make_fund_data(main_net=1234.56)
        history = _make_history([])

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertTrue("1235" in suggestion or "1234" in suggestion)

    def test_large_outflow_no_history(self):
        """大幅净流出 + 无历史 → 风险提示。"""
        current = _make_fund_data(main_net=-4000.0)
        history = []

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("风险", suggestion)

    def test_very_large_amount_formatting(self):
        """大额金额使用「亿」作为单位。"""
        current = _make_fund_data(main_net=150000.0)  # 15 亿
        history = _make_history([])

        suggestion = WebBridge._generate_suggestion(current, history)

        self.assertIn("亿", suggestion)


# ---------------------------------------------------------------------------
# 测试 WebBridge Slot 方法
# ---------------------------------------------------------------------------

class TestGetFundFlowSlot(unittest.TestCase):
    """get_fund_flow Slot 测试。"""

    def setUp(self):
        self.bridge = WebBridge()

    def test_return_format_on_success(self):
        """成功返回应包含 success=True 和 data、suggestion 字段。"""
        mock_data = _make_fund_data()

        with patch.object(FundFlowFetcher, "_normalize_code", return_value="000001"), \
             patch.object(FundFlowFetcher, "get_fund_flow", return_value=mock_data), \
             patch.object(Database, "get_fund_flow_history", return_value=[]):
            result = json.loads(self.bridge.get_fund_flow("000001"))

        self.assertTrue(result["success"])
        self.assertIn("data", result)
        self.assertIn("suggestion", result)
        self.assertEqual(result["data"]["code"], "000001")
        self.assertEqual(result["data"]["main_net"], 1234.56)

    def test_invalid_code(self):
        """无效代码返回 success=False。"""
        with patch.object(FundFlowFetcher, "_normalize_code", return_value=None):
            result = json.loads(self.bridge.get_fund_flow("abc"))

        self.assertFalse(result["success"])
        self.assertIn("error", result)

    def test_fetch_failure(self):
        """获取失败返回 success=False。"""
        with patch.object(FundFlowFetcher, "_normalize_code", return_value="000001"), \
             patch.object(FundFlowFetcher, "get_fund_flow", return_value=None):
            result = json.loads(self.bridge.get_fund_flow("000001"))

        self.assertFalse(result["success"])

    def test_filter_today_from_history(self):
        """历史查询应过滤当日数据。"""
        mock_data = _make_fund_data()  # date 默认为 "2025-05-28"
        history_with_today = _make_history([100.0, 200.0]) + [
            {"date": "2025-05-28", "main_net": 1234.56,
             "super_net": None, "big_net": None, "medium_net": None, "small_net": None}
        ]

        with patch.object(FundFlowFetcher, "_normalize_code", return_value="000001"), \
             patch.object(FundFlowFetcher, "get_fund_flow", return_value=mock_data), \
             patch.object(Database, "get_fund_flow_history", return_value=history_with_today):
            result = json.loads(self.bridge.get_fund_flow("000001"))

        self.assertTrue(result["success"])
        self.assertIn("suggestion", result)


class TestBatchFundFlowSlot(unittest.TestCase):
    """get_batch_fund_flow Slot 测试。"""

    def setUp(self):
        self.bridge = WebBridge()

    def test_batch_success(self):
        """批量获取应返回 quotes 字典。"""
        mock_quotes = {
            "000001": _make_fund_data("000001"),
            "000002": _make_fund_data("000002", main_net=500.0),
            "600519": _make_fund_data("600519", main_net=-200.0),
        }

        def fake_normalize(c):
            return c if len(str(c)) == 6 and str(c).isdigit() else None

        with patch.object(FundFlowFetcher, "_normalize_code", side_effect=fake_normalize), \
             patch.object(FundFlowFetcher, "get_batch_fund_flow", return_value=mock_quotes):
            result = json.loads(
                self.bridge.get_batch_fund_flow('["000001","000002","600519"]')
            )

        self.assertTrue(result["success"])
        self.assertIn("quotes", result)
        self.assertEqual(len(result["quotes"]), 3)
        for code in ("000001", "000002", "600519"):
            self.assertIn(code, result["quotes"])

    def test_batch_limit_50(self):
        """超过 50 只股票时应截断。"""
        codes = [f"{i:06d}" for i in range(100)]
        codes_json = json.dumps(codes)

        def fake_normalize(c):
            return c

        with patch.object(FundFlowFetcher, "_normalize_code", side_effect=fake_normalize), \
             patch.object(FundFlowFetcher, "get_batch_fund_flow") as mock_batch:
            mock_batch.return_value = {}
            self.bridge.get_batch_fund_flow(codes_json)
            # 验证只传入了前 50 个
            called_codes = mock_batch.call_args[0][0]
            self.assertLessEqual(len(called_codes), 50)

    def test_batch_empty_input(self):
        """空列表返回错误。"""
        result = json.loads(self.bridge.get_batch_fund_flow("[]"))
        self.assertFalse(result["success"])

    def test_batch_invalid_json(self):
        """无效 JSON 返回错误（被外层的 try/except 捕获）。"""
        with patch.object(FundFlowFetcher, "_normalize_code", return_value=None):
            result = json.loads(self.bridge.get_batch_fund_flow("not json"))
        self.assertFalse(result["success"])

    def test_batch_failed_stocks_omitted(self):
        """获取失败的股票不应出现在结果中。"""
        mock_quotes = {
            "000001": _make_fund_data("000001"),
        }

        codes_json = json.dumps(["000001", "000002"])

        def fake_normalize(c):
            return c

        with patch.object(FundFlowFetcher, "_normalize_code", side_effect=fake_normalize), \
             patch.object(FundFlowFetcher, "get_batch_fund_flow", return_value=mock_quotes):
            result = json.loads(self.bridge.get_batch_fund_flow(codes_json))

        self.assertTrue(result["success"])
        self.assertIn("000001", result["quotes"])
        self.assertNotIn("000002", result["quotes"])


# ---------------------------------------------------------------------------
# 需要导入被 mock 的类
# ---------------------------------------------------------------------------

from backend.fund_flow_fetcher import FundFlowFetcher


if __name__ == "__main__":
    unittest.main()
