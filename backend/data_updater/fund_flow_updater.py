"""资金流向数据获取模块：东方财富 API（主源）+ 同花顺（备用源），支持缓存与重试。

提供 FundFlowFetcher 类，封装资金流向数据的获取、解析、缓存和容错切换。
主源使用 curl_cffi 模拟浏览器请求东方财富 API，备用源使用同花顺页面抓取。
"""

import json
import re
import time
import random
import threading
from typing import Dict, Optional

import requests
from bs4 import BeautifulSoup

try:
    from curl_cffi import requests as cffi_requests
    _USE_CFFI = True
except ImportError:
    cffi_requests = None
    _USE_CFFI = False

# ---------------------------------------------------------------------------
# 统一返回数据结构字段说明
#   code       : 纯数字股票代码（6 位）
#   date       : 交易日（YYYY-MM-DD）
#   main_net   : 主力净流入（万元）
#   super_net  : 超大单净流入（万元）
#   big_net    : 大单净流入（万元）
#   medium_net : 中单净流入（万元）
#   small_net  : 小单净流入（万元）
#   source     : 数据来源标识（"eastmoney" / "tonghuashun"）
# ---------------------------------------------------------------------------

# 重试配置
MAX_RETRIES = 3
RETRY_BASE_DELAY = 2  # 基础退避秒数，第 n 次重试等待 2^n 秒


class FundFlowFetcher:
    """双源资金流向获取器。

    主源：东方财富 API（curl_cffi，返回单位：元 → 转换为万元）
    备用源：同花顺页面抓取（返回单位：万元）

    使用示例：
        fetcher = FundFlowFetcher(cache_ttl=60)
        data = fetcher.get_fund_flow("000001")
    """

    # -- 同花顺备用源 ---------------------------------------------------------
    THS_URL = "http://stockpage.10jqka.com.cn/{code}/funds/"

    REQUEST_TIMEOUT = 10  # 秒

    def __init__(self, cache_ttl=60):
        """初始化获取器。

        Args:
            cache_ttl: 缓存有效期（秒），默认 60。设为 0 表示不缓存。
        """
        self._cache_ttl = cache_ttl
        self._cache = {}           # {code: (timestamp, data_dict)}
        self._cache_lock = threading.Lock()

        # 统一会话（备用）
        self._session = requests.Session()
        self._session.headers.update({
            "User-Agent": (
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
                "AppleWebKit/537.36 (KHTML, like Gecko) "
                "Chrome/120.0.0.0 Safari/537.36"
            ),
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
            "Accept-Encoding": "gzip, deflate, br",
            "Cache-Control": "max-age=0",
            "Connection": "keep-alive",
            "DNT": "1",
            "Upgrade-Insecure-Requests": "1",
            "Sec-Fetch-Dest": "document",
            "Sec-Fetch-Mode": "navigate",
            "Sec-Fetch-Site": "none",
            "Sec-Fetch-User": "?1",
        })

    # ==================================================================
    # 公开方法
    # ==================================================================

    def get_fund_flow(self, code: str) -> Optional[Dict]:
        """获取单只股票最新交易日资金流向。

        Args:
            code: 股票代码，支持 '000001' / 'sz000001' / '000001.SZ' 等格式

        Returns:
            dict 或 None — 统一格式的资金流向数据
        """
        result = self.get_fund_flow_recent(code, days=1)
        if result:
            return result[0]
        return None

    def get_fund_flow_recent(self, code: str, days: int = 5):
        """获取单只股票最近 N 个交易日资金流向。

        Args:
            code: 股票代码
            days: 取最近几个交易日，默认 5

        Returns:
            list[dict] 或 [] — 按日期升序排列的资金流向数据列表
        """
        pure_code = self._normalize_code(code)
        if pure_code is None:
            print(f"[FundFlow] 无效的股票代码: {code}")
            return []

        # 检查缓存（多日缓存 key = code_days）
        cache_key = f"{pure_code}_{days}"
        cached = self._cache_get(cache_key)
        if cached is not None:
            return cached if isinstance(cached, list) else [cached]

        # 主源：东方财富 API
        data = self._fetch_from_eastmoney(pure_code, days=days)
        if data:
            self._cache_set(cache_key, data)
            return data

        # 备用源：同花顺（只返回1天）
        print(f"[FundFlow] 东方财富获取 {pure_code} 失败，切换至同花顺")
        time.sleep(random.uniform(0.5, 1.0))
        single = self._fetch_from_tonghuashun(pure_code)
        if single is not None:
            self._cache_set(cache_key, [single])
            return [single]

        print(f"[FundFlow] 所有数据源均失败 {pure_code}")
        return []

    def get_batch_fund_flow(self, codes, max_workers=5):
        """批量获取资金流向。

        逐股票检查缓存，仅对未命中或过期的股票发起网络请求。
        控制并发数和提交间隔。

        Args:
            codes: 股票代码列表
            max_workers: 最大并发线程数

        Returns:
            dict — {code: data_dict}，失败的股票不包含在内
        """
        from concurrent.futures import ThreadPoolExecutor, as_completed

        result = {}
        to_fetch = []

        for c in codes:
            pure = self._normalize_code(c)
            if pure is None:
                continue
            cached = self._cache_get(pure)
            if cached is not None:
                result[pure] = cached
            else:
                to_fetch.append(pure)

        if not to_fetch:
            return result

        max_workers = min(max_workers, len(to_fetch))
        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {}
            for c in to_fetch:
                # 提交任务，间隔 0.2 秒
                futures[executor.submit(self.get_fund_flow, c)] = c
                time.sleep(0.2)

            for future in as_completed(futures):
                code = futures[future]
                try:
                    data = future.result(timeout=self.REQUEST_TIMEOUT + 5)
                except Exception:
                    data = None
                if data is not None:
                    result[code] = data

        return result

    # ==================================================================
    # 东方财富 API（主源）
    # ==================================================================

    def _fetch_from_eastmoney(self, pure_code: str, days: int = 1):
        """使用 curl_cffi 请求东方财富 API，获取资金流向数据。

        返回数据单位：元 → 内部转换为万元。
        返回最近 days 个交易日的数据（list of dict），日期升序。
        """
        market = "0" if not pure_code.startswith("6") else "1"
        url = (
            f"https://push2.eastmoney.com/api/qt/stock/fflow/daykline/get"
            f"?secid={market}.{pure_code}"
            f"&fields1=f1,f2,f3,f7"
            f"&fields2=f51,f52,f53,f54,f55,f56,f57,f58,f59,f60,f61,f62,f63"
            f"&ut=fa5fd1943c7b386f172d6893dbfba10b"
        )

        time.sleep(random.uniform(0.8, 2.5))

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                if _USE_CFFI and cffi_requests:
                    resp = cffi_requests.get(url, impersonate="chrome110", timeout=self.REQUEST_TIMEOUT)
                else:
                    resp = self._session.get(url, timeout=self.REQUEST_TIMEOUT)

                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}")

                data = resp.json()
                klines = data.get("data", {}).get("klines")
                if not klines:
                    raise Exception("无 klines 数据")

                # 截取最近 days 条（klines 已按日期升序排列）
                recent = klines[-days:] if len(klines) >= days else klines

                def to_wan(val):
                    v = self._safe_float(val)
                    return round(v / 10000, 2) if v is not None else None

                results = []
                for line in recent:
                    parts = line.split(",")
                    if len(parts) < 6:
                        continue
                    results.append({
                        "code": pure_code,
                        "date": parts[0],
                        "main_net": to_wan(parts[1]),
                        "small_net": to_wan(parts[2]),
                        "medium_net": to_wan(parts[3]),
                        "big_net": to_wan(parts[4]),
                        "super_net": to_wan(parts[5]),
                        "source": "eastmoney",
                    })

                if results:
                    print(f"[FundFlow] 东方财富获取 {pure_code} 成功 ({len(results)} 天)")
                    return results

            except Exception as e:
                print(f"[FundFlow] 东方财富请求失败 {pure_code} (第{attempt}次): {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BASE_DELAY ** attempt)

        return []

    # ==================================================================
    # 同花顺备用源
    # ==================================================================

    def _fetch_from_tonghuashun(self, pure_code: str) -> Optional[Dict]:
        """从同花顺个股资金流向详情页获取数据。

        页面 URL：http://stockpage.10jqka.com.cn/{code}/funds/
        解析 HTML 表格，提取最新一条交易日的主力/超大单/大单/中单净流入（万元）。
        """
        url = self.THS_URL.format(code=pure_code)
        time.sleep(random.uniform(0.5, 1.5))

        for attempt in range(1, MAX_RETRIES + 1):
            try:
                resp = self._session.get(url, timeout=self.REQUEST_TIMEOUT)
                resp.encoding = "gbk"
                if resp.status_code != 200:
                    raise Exception(f"HTTP {resp.status_code}")

                soup = BeautifulSoup(resp.text, "html.parser")
                table = soup.find("table", class_="m-table")
                if not table:
                    raise Exception("未找到表格")

                # 提取数据行
                rows = table.find_all("tr")
                data_rows = []
                for tr in rows:
                    tds = tr.find_all("td")
                    if not tds:
                        continue
                    cols = [td.text.strip() for td in tds]
                    # 第一列为日期（YYYYMMDD）
                    if re.match(r"^\d{8}$", cols[0]):
                        data_rows.append(cols)

                if not data_rows:
                    raise Exception("无数据行")

                latest = data_rows[0]  # 最新交易日
                if len(latest) < 13:
                    raise Exception("字段不足")

                # 根据经验列索引：
                # 0:日期, 1:收盘价, 2:涨跌幅, 3:主力净流入(万元),
                # 4-7:其他, 8:超大单净流入(万元), 9:占比, 10:大单净流入(万元), 11:占比, 12:中单净流入(万元), 13:占比
                result = {
                    "code": pure_code,
                    "date": f"{latest[0][:4]}-{latest[0][4:6]}-{latest[0][6:8]}",
                    "main_net": self._safe_float(latest[3]),
                    "super_net": self._safe_float(latest[8]),
                    "big_net": self._safe_float(latest[10]),
                    "medium_net": self._safe_float(latest[12]),
                    "small_net": None,  # 同花顺页面不提供小单
                    "source": "tonghuashun"
                }

                if result["main_net"] is not None:
                    print(f"[FundFlow] 同花顺获取 {pure_code} 成功")
                    return result

            except Exception as e:
                print(f"[FundFlow] 同花顺请求失败 {pure_code} (第{attempt}次): {e}")
                if attempt < MAX_RETRIES:
                    time.sleep(RETRY_BASE_DELAY ** attempt)

        return None

    # ==================================================================
    # 缓存管理
    # ==================================================================

    def _cache_get(self, pure_code):
        if self._cache_ttl <= 0:
            return None
        with self._cache_lock:
            entry = self._cache.get(pure_code)
            if entry is None:
                return None
            ts, data = entry
            if time.time() - ts < self._cache_ttl:
                return data
            del self._cache[pure_code]
            return None

    def _cache_set(self, pure_code, data):
        if self._cache_ttl <= 0:
            return
        with self._cache_lock:
            self._cache[pure_code] = (time.time(), data)

    def clear_cache(self):
        with self._cache_lock:
            self._cache.clear()

    # ==================================================================
    # 工具方法
    # ==================================================================

    @staticmethod
    def _normalize_code(code):
        code = str(code).strip().upper()
        if "." in code:
            code = code.split(".")[0]
        code = re.sub(r"^(SZ|SH)", "", code)
        if re.fullmatch(r"\d{6}", code):
            return code
        return None

    @staticmethod
    def _safe_float(val):
        if val is None:
            return None
        if isinstance(val, (int, float)):
            if str(val).lower() == "nan":
                return None
            return round(float(val), 2)
        s = str(val).strip()
        if s == "" or s.lower() == "nan" or s == "-":
            return None
        try:
            return round(float(s), 2)
        except ValueError:
            return None