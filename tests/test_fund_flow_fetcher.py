"""资金流向获取模块单元测试。

测试覆盖：单只获取（同花顺/AKShare/新浪）、缓存命中、故障转移、批量获取。
使用 unittest.mock 模拟网络请求，避免依赖外部 API。
"""

import json
import time
import unittest
from unittest.mock import patch, MagicMock

from backend.fund_flow_fetcher import FundFlowFetcher


# ---------------------------------------------------------------------------
# 模拟响应构造工具
# ---------------------------------------------------------------------------

def _make_th_html():
    """构造同花顺个股资金流向 HTML 响应（GBK 编码模拟）。

    返回包含 14 列表格的 HTML，第一行为最新交易日数据。
    单位：万元。Col 3=主力, Col 8=超大单, Col 10=大单, Col 12=中单。
    """
    return (
        '<html><body>'
        '<table>'
        '<tr><td>20250528</td><td>10.69</td><td>-0.65%</td>'
        '<td>1234.56</td><td>-</td><td>-</td><td>-</td><td>-</td>'
        '<td>500.00</td><td>1.5%</td>'
        '<td>734.56</td><td>2.0%</td>'
        '<td>-200.00</td><td>0.5%</td></tr>'
        '<tr><td>20250527</td><td>10.70</td><td>0.50%</td>'
        '<td>800.00</td><td>-</td><td>-</td><td>-</td><td>-</td>'
        '<td>300.00</td><td>1.0%</td>'
        '<td>400.00</td><td>1.5%</td>'
        '<td>100.00</td><td>0.3%</td></tr>'
        '</table>'
        '</body></html>'
    )


def _make_akshare_df_mock(main_net=1234.56, super_net=500.0, big_net=734.56,
                           medium_net=-200.0, small_net=-1034.56, date="2025-05-28"):
    """构造 AKShare 返回的模拟 DataFrame。"""
    latest = {
        "日期": date,
        "主力净流入-净额": main_net,
        "超大单净流入-净额": super_net,
        "大单净流入-净额": big_net,
        "中单净流入-净额": medium_net,
        "小单净流入-净额": small_net,
    }
    df = MagicMock()
    df.empty = False
    df.columns = list(latest.keys())
    df.iloc.__getitem__.return_value = latest
    return df


def _make_sina_response(values=None):
    """构造新浪财经 JSONP 响应。"""
    if values is None:
        values = {
            "net_main": 12345678,
            "net_super": 5000000,
            "net_big": 7345678,
            "net_mid": -2000000,
            "net_small": -10345678,
        }
    return f"callback123({json.dumps(values)})"


# ---------------------------------------------------------------------------
# 测试类
# ---------------------------------------------------------------------------

class TestFundFlowSingleStock(unittest.TestCase):
    """单只股票获取测试。"""

    def test_get_single_stock_tonghuashun(self):
        """验证从同花顺获取 000001 数据，source 为 tonghuashun，字段解析正确。"""
        fetcher = FundFlowFetcher(cache_ttl=0)
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.text = _make_th_html()

        with patch.object(fetcher._session, "get", return_value=mock_resp):
            result = fetcher.get_fund_flow("000001")

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "000001")
        self.assertEqual(result["date"], "2025-05-28")
        self.assertEqual(result["source"], "tonghuashun")
        self.assertEqual(result["main_net"], 1234.56)
        self.assertEqual(result["super_net"], 500.00)
        self.assertEqual(result["big_net"], 734.56)
        self.assertEqual(result["medium_net"], -200.00)
        self.assertIsNone(result["small_net"])

    def test_get_single_stock_akshare(self):
        """验证从 AKShare 获取数据（同花顺失败时降级）。"""
        fetcher = FundFlowFetcher(cache_ttl=0)
        fetcher._akshare_available = True

        with patch.object(fetcher, "_fetch_from_tonghuashun", return_value=None), \
             patch.object(fetcher, "_fetch_from_akshare") as mock_ak:
            mock_ak.return_value = {
                "code": "000001", "date": "2025-05-28",
                "main_net": 1234.56, "super_net": 500.00,
                "big_net": 734.56, "medium_net": -200.00,
                "small_net": -1034.56, "source": "akshare",
            }
            result = fetcher.get_fund_flow("000001")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "akshare")
        self.assertEqual(result["main_net"], 1234.56)

    def test_parse_tonghuashun(self):
        """验证 _parse_tonghuashun 正确解析 HTML。"""
        fetcher = FundFlowFetcher(cache_ttl=0)
        result = fetcher._parse_tonghuashun("000001", _make_th_html())

        self.assertIsNotNone(result)
        self.assertEqual(result["code"], "000001")
        self.assertEqual(result["source"], "tonghuashun")
        self.assertEqual(result["date"], "2025-05-28")
        self.assertEqual(result["main_net"], 1234.56)
        self.assertEqual(result["super_net"], 500.0)
        self.assertEqual(result["big_net"], 734.56)
        self.assertEqual(result["medium_net"], -200.0)
        self.assertIsNone(result["small_net"])

    def test_parse_akshare(self):
        """验证 _parse_akshare 正确解析 DataFrame 模拟数据。"""
        df = _make_akshare_df_mock()
        fetcher = FundFlowFetcher(cache_ttl=0)
        result = fetcher._parse_akshare("000001", df)

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "akshare")
        self.assertEqual(result["date"], "2025-05-28")
        self.assertEqual(result["main_net"], 1234.56)

    def test_get_single_stock_sina(self):
        """验证从新浪财经获取数据（同花顺和AKShare都失败时降级）。"""
        fetcher = FundFlowFetcher(cache_ttl=0, default_strategy="failover")
        mock_resp = MagicMock()
        mock_resp.text = _make_sina_response()

        with patch.object(fetcher, "_fetch_from_tonghuashun", return_value=None), \
             patch.object(fetcher, "_fetch_from_akshare", return_value=None), \
             patch.object(fetcher._session, "get", return_value=mock_resp):
            result = fetcher.get_fund_flow("600519")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "sina")
        self.assertEqual(result["main_net"], 1234.57)

    def test_code_normalization(self):
        """验证多种代码格式输入均可正确归一化。"""
        fetcher = FundFlowFetcher(cache_ttl=0)

        def fake_ths(code):
            return {
                "code": code, "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "tonghuashun",
            }

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_ths):
            for code_input in ("000001", "sz000001", "SZ000001", "000001.SZ"):
                result = fetcher.get_fund_flow(code_input)
                self.assertIsNotNone(result, f"代码格式 {code_input} 应解析成功")
                self.assertEqual(result["code"], "000001")

    def test_invalid_code(self):
        """无效代码应返回 None。"""
        fetcher = FundFlowFetcher()
        self.assertIsNone(fetcher.get_fund_flow("abc"))
        self.assertIsNone(fetcher.get_fund_flow("12345"))
        self.assertIsNone(fetcher.get_fund_flow(""))


class TestCache(unittest.TestCase):
    """缓存行为测试。"""

    def test_cache_hit(self):
        """连续两次调用相同股票，第二次应命中缓存。"""
        fetcher = FundFlowFetcher(cache_ttl=30)
        mock_data = {
            "code": "000001", "date": "2025-05-28",
            "main_net": 100.0, "super_net": 50.0,
            "big_net": 50.0, "medium_net": -30.0,
            "small_net": -70.0, "source": "tonghuashun",
        }
        call_count = 0

        def fake_fetch(code):
            nonlocal call_count
            call_count += 1
            return dict(mock_data)

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_fetch):
            r1 = fetcher.get_fund_flow("000001")
            r2 = fetcher.get_fund_flow("000001")

        self.assertIsNotNone(r1)
        self.assertIsNotNone(r2)
        self.assertEqual(call_count, 1, "第二次调用应命中缓存")

    def test_cache_expiry(self):
        """缓存过期后应重新发起请求。"""
        fetcher = FundFlowFetcher(cache_ttl=0)
        call_count = 0

        def fake_fetch(code):
            nonlocal call_count
            call_count += 1
            return {
                "code": code, "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "tonghuashun",
            }

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_fetch):
            fetcher.get_fund_flow("000001")
            fetcher.get_fund_flow("000001")

        self.assertEqual(call_count, 2, "TTL=0 不应使用缓存")

    def test_clear_cache(self):
        """清空缓存后应重新请求。"""
        fetcher = FundFlowFetcher(cache_ttl=300)
        call_count = 0

        def fake_fetch(code):
            nonlocal call_count
            call_count += 1
            return {
                "code": code, "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "tonghuashun",
            }

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_fetch):
            fetcher.get_fund_flow("000001")
            fetcher.clear_cache()
            fetcher.get_fund_flow("000001")

        self.assertEqual(call_count, 2)


class TestFailover(unittest.TestCase):
    """故障转移测试。"""

    def test_failover_ak_to_ths(self):
        """AKShare 失败时自动切换同花顺。"""
        fetcher = FundFlowFetcher(cache_ttl=0)

        with patch.object(fetcher, "_fetch_from_akshare", return_value=None) as mock_ak, \
             patch.object(fetcher, "_fetch_from_tonghuashun") as mock_ths, \
             patch.object(fetcher, "_fetch_from_sina") as mock_sina:
            mock_ths.return_value = {
                "code": "000001", "date": "2025-05-28",
                "main_net": 200.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "tonghuashun",
            }

            result = fetcher.get_fund_flow("000001")

            self.assertIsNotNone(result)
            self.assertEqual(result["source"], "tonghuashun")
            mock_ak.assert_called_once()
            mock_ths.assert_called_once()
            mock_sina.assert_not_called()

    def test_failover_to_sina(self):
        """同花顺和AKShare都失败时切换新浪。"""
        fetcher = FundFlowFetcher(cache_ttl=0)

        with patch.object(fetcher, "_fetch_from_tonghuashun", return_value=None) as mock_ths, \
             patch.object(fetcher, "_fetch_from_akshare", return_value=None) as mock_ak, \
             patch.object(fetcher, "_fetch_from_sina") as mock_sina:
            mock_sina.return_value = {
                "code": "000001", "date": "2025-05-28",
                "main_net": 200.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "sina",
            }

            result = fetcher.get_fund_flow("000001")

            self.assertIsNotNone(result)
            self.assertEqual(result["source"], "sina")
            mock_ths.assert_called_once()
            mock_ak.assert_called_once()
            mock_sina.assert_called_once()

    def test_failover_all_fail(self):
        """三个源都失败时返回 None。"""
        fetcher = FundFlowFetcher(cache_ttl=0)

        with patch.object(fetcher, "_fetch_from_tonghuashun", return_value=None), \
             patch.object(fetcher, "_fetch_from_akshare", return_value=None), \
             patch.object(fetcher, "_fetch_from_sina", return_value=None):
            result = fetcher.get_fund_flow("000001")
            self.assertIsNone(result)

    def test_ak_success_no_failover(self):
        """AKShare 主源成功时不应调用备用源。"""
        fetcher = FundFlowFetcher(cache_ttl=0)

        with patch.object(fetcher, "_fetch_from_akshare") as mock_ak, \
             patch.object(fetcher, "_fetch_from_tonghuashun") as mock_ths, \
             patch.object(fetcher, "_fetch_from_sina") as mock_sina:
            mock_ak.return_value = {
                "code": "000001", "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "akshare",
            }

            result = fetcher.get_fund_flow("000001")
            self.assertIsNotNone(result)
            self.assertEqual(result["source"], "akshare")
            mock_ak.assert_called_once()
            mock_ths.assert_not_called()
            mock_sina.assert_not_called()


class TestBatch(unittest.TestCase):
    """批量获取测试。"""

    def test_batch_three_stocks(self):
        """批量获取 3 只股票，返回字典长度正确。"""
        fetcher = FundFlowFetcher(cache_ttl=0)

        def fake_fetch(code):
            return {
                "code": code, "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "tonghuashun",
            }

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_fetch):
            result = fetcher.get_batch_fund_flow(["000001", "000002", "600519"])

        self.assertEqual(len(result), 3)
        for code in ("000001", "000002", "600519"):
            self.assertIn(code, result)
            self.assertEqual(result[code]["main_net"], 100.0)

    def test_batch_with_partial_cache(self):
        """批量请求中，已缓存的股票不应重新请求。"""
        fetcher = FundFlowFetcher(cache_ttl=300)
        fetcher._cache_set("000001", {
            "code": "000001", "date": "2025-05-28",
            "main_net": 999.0, "super_net": None,
            "big_net": None, "medium_net": None,
            "small_net": None, "source": "tonghuashun",
        })

        fetch_calls = []

        def fake_fetch(code):
            fetch_calls.append(code)
            return {
                "code": code, "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "tonghuashun",
            }

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_fetch):
            result = fetcher.get_batch_fund_flow(["000001", "000002", "600519"])

        self.assertEqual(len(result), 3)
        self.assertEqual(result["000001"]["main_net"], 999.0)
        self.assertEqual(result["000002"]["main_net"], 100.0)
        self.assertNotIn("000001", fetch_calls)
        self.assertIn("000002", fetch_calls)

    def test_batch_empty_list(self):
        """空列表输入应返回空字典。"""
        fetcher = FundFlowFetcher()
        result = fetcher.get_batch_fund_flow([])
        self.assertEqual(result, {})


class TestRoundRobin(unittest.TestCase):
    """轮询策略测试。"""

    def test_round_robin_alternates(self):
        """轮询应在三个源之间循环。"""
        fetcher = FundFlowFetcher(cache_ttl=0, default_strategy="round_robin")
        fetch_order = []

        def fake_ths(code):
            fetch_order.append("ths")
            return {"code": code, "date": "2025-05-28", "main_net": 1.0,
                    "super_net": None, "big_net": None, "medium_net": None,
                    "small_net": None, "source": "tonghuashun"}

        def fake_ak(code):
            fetch_order.append("ak")
            return {"code": code, "date": "2025-05-28", "main_net": 1.0,
                    "super_net": None, "big_net": None, "medium_net": None,
                    "small_net": None, "source": "akshare"}

        def fake_sina(code):
            fetch_order.append("sina")
            return {"code": code, "date": "2025-05-28", "main_net": 1.0,
                    "super_net": None, "big_net": None, "medium_net": None,
                    "small_net": None, "source": "sina"}

        with patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=fake_ths), \
             patch.object(fetcher, "_fetch_from_akshare", side_effect=fake_ak), \
             patch.object(fetcher, "_fetch_from_sina", side_effect=fake_sina):
            for _ in range(6):
                fetcher.get_fund_flow("000001")

        # 3-source round robin: sources = [akshare, tonghuashun, sina]
        # 1: mod=1, start=ths→succeeds ("ths")
        # 2: mod=2, start=sina→succeeds ("sina")
        # 3: mod=0, start=ak→succeeds ("ak")
        # 4: mod=1, start=ths→succeeds ("ths")
        # 5: mod=2, start=sina→succeeds ("sina")
        # 6: mod=0, start=ak→succeeds ("ak")
        self.assertEqual(fetch_order, ["ths", "sina", "ak", "ths", "sina", "ak"])

    def test_round_robin_fallback(self):
        """轮询中前两个源失败时自动切换到第三个。"""
        fetcher = FundFlowFetcher(cache_ttl=0, default_strategy="round_robin")

        with patch.object(fetcher, "_fetch_from_tonghuashun", return_value=None), \
             patch.object(fetcher, "_fetch_from_akshare", return_value=None), \
             patch.object(fetcher, "_fetch_from_sina") as mock_sina:
            mock_sina.return_value = {
                "code": "000001", "date": "2025-05-28",
                "main_net": 100.0, "super_net": None,
                "big_net": None, "medium_net": None,
                "small_net": None, "source": "sina",
            }
            result = fetcher.get_fund_flow("000001")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "sina")


class TestRace(unittest.TestCase):
    """竞速策略测试。"""

    def test_race_returns_first_valid(self):
        """竞速应返回最先完成的有效结果。"""
        fetcher = FundFlowFetcher(cache_ttl=0, default_strategy="race")

        def fast_ak(code):
            return {"code": code, "date": "2025-05-28", "main_net": 300.0,
                    "super_net": None, "big_net": None, "medium_net": None,
                    "small_net": None, "source": "akshare"}

        def slow_ths(code):
            time.sleep(0.5)
            return {"code": code, "date": "2025-05-28", "main_net": 1.0,
                    "super_net": None, "big_net": None, "medium_net": None,
                    "small_net": None, "source": "tonghuashun"}

        def slow_sina(code):
            time.sleep(0.5)
            return {"code": code, "date": "2025-05-28", "main_net": 1.0,
                    "super_net": None, "big_net": None, "medium_net": None,
                    "small_net": None, "source": "sina"}

        with patch.object(fetcher, "_fetch_from_akshare", side_effect=fast_ak), \
             patch.object(fetcher, "_fetch_from_tonghuashun", side_effect=slow_ths), \
             patch.object(fetcher, "_fetch_from_sina", side_effect=slow_sina):
            result = fetcher.get_fund_flow("000001")

        self.assertIsNotNone(result)
        self.assertEqual(result["source"], "akshare")
        self.assertEqual(result["main_net"], 300.0)

    def test_race_all_fail(self):
        """三个源都失败时返回 None。"""
        fetcher = FundFlowFetcher(cache_ttl=0, default_strategy="race")

        with patch.object(fetcher, "_fetch_from_tonghuashun", return_value=None), \
             patch.object(fetcher, "_fetch_from_akshare", return_value=None), \
             patch.object(fetcher, "_fetch_from_sina", return_value=None):
            result = fetcher.get_fund_flow("000001")
            self.assertIsNone(result)


if __name__ == "__main__":
    unittest.main()
