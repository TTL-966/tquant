"""实时行情获取服务：腾讯 + 新浪双接口，支持批量获取，自动容错切换。"""

import re
import time
import threading
from concurrent.futures import ThreadPoolExecutor, as_completed
from urllib import request
from datetime import datetime


class RealtimeQuoteFetcher:
    """双源实时行情获取器，优先腾讯，失败后自动切换新浪。"""

    def __init__(self, max_failures=5):
        self._fail_count = 0
        self._max_failures = max_failures
        self._lock = threading.Lock()
        self._last_success_time = 0

    # ---------- 单只获取 ----------
    def fetch_quote(self, code):
        """获取单只股票实时行情，返回 dict 或 None。"""
        result = self._fetch_tencent(code)
        if result is None:
            result = self._fetch_sina(code)
        self._update_counter(result is not None)
        return result

    # ---------- 批量获取 ----------
    def fetch_quotes(self, codes, batch_size=10, max_workers=5):
        """批量获取实时行情（并发），返回 dict {code: {...}}。
        将请求拆分为小批次并发执行，降低总延迟。
        """
        codes_pure = [c.split('.')[0] for c in codes]
        if not codes_pure:
            return {}

        # 拆分为小批次
        batches = []
        for i in range(0, len(codes_pure), batch_size):
            batches.append(codes_pure[i:i + batch_size])

        result = {}

        # 单批次直接请求
        if len(batches) == 1:
            batch_result = self._fetch_tencent_batch(batches[0])
            if batch_result:
                result.update(batch_result)
            missing = [c for c in batches[0] if c not in result]
            for c in missing:
                q = self.fetch_quote(c)
                if q:
                    result[c] = q
            return result

        # 多批次并发请求
        with ThreadPoolExecutor(max_workers=min(max_workers, len(batches))) as executor:
            future_to_batch = {
                executor.submit(self._fetch_tencent_batch, batch): batch
                for batch in batches
            }
            for future in as_completed(future_to_batch):
                batch = future_to_batch[future]
                try:
                    batch_result = future.result(timeout=8)
                    if batch_result:
                        result.update(batch_result)
                except Exception:
                    pass
                # 补获取缺失的
                missing = [c for c in batch if c not in result]
                for c in missing:
                    q = self.fetch_quote(c)
                    if q:
                        result[c] = q

        return result

    @property
    def healthy(self):
        with self._lock:
            return self._fail_count < self._max_failures

    # ---------- 腾讯单只 ----------
    def _fetch_tencent(self, code):
        code_pure = code.split('.')[0]
        q_code = self._t_code(code_pure)
        url = f'https://web.sqt.gtimg.cn/q={q_code}'
        try:
            req = request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://gu.qq.com',
            })
            with request.urlopen(req, timeout=3) as resp:
                raw = resp.read()
            text = raw.decode('gbk', errors='replace')
            return self._parse_tencent(text, code_pure)
        except Exception:
            return None

    # ---------- 腾讯批量 ----------
    def _fetch_tencent_batch(self, codes_pure):
        """批量获取，返回 {code: dict}。"""
        if not codes_pure:
            return {}
        q_codes = ','.join([self._t_code(c) for c in codes_pure])
        url = f'https://web.sqt.gtimg.cn/q={q_codes}'
        try:
            req = request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'https://gu.qq.com',
            })
            with request.urlopen(req, timeout=5) as resp:
                raw = resp.read()
            text = raw.decode('gbk', errors='replace')
            return self._parse_tencent_batch(text)
        except Exception:
            return {}

    def _parse_tencent_batch(self, text):
        """解析腾讯批量返回，每行一条 v_shXXXXXX="..."。"""
        results = {}
        for line in text.strip().split('\n'):
            m = re.search(r'_(\w+?)="(.+)"', line)
            if not m:
                continue
            prefix_code = m.group(1)  # e.g. sz000001
            fields = m.group(2).split('~')
            if len(fields) < 38:
                continue
            code_pure = prefix_code[2:]  # strip sz/sh prefix
            parsed = self._parse_tencent_fields(fields, code_pure)
            if parsed:
                results[code_pure] = parsed
        return results

    def _parse_tencent(self, text, code_pure):
        m = re.search(r'="(.+)"', text)
        if not m:
            return None
        fields = m.group(1).split('~')
        if len(fields) < 38:
            return None
        return self._parse_tencent_fields(fields, code_pure)

    def _parse_tencent_fields(self, fields, code_pure):
        def _f(i):
            try:
                return float(fields[i]) if fields[i] else 0.0
            except ValueError:
                return 0.0
        price = _f(3)
        prev_close = _f(4)
        if price <= 0:
            return None
        return {
            'code': code_pure,
            'price': price,
            'open': _f(5),
            'high': _f(33),
            'low': _f(34),
            'volume': int(_f(36)),
            'prev_close': prev_close if prev_close > 0 else _f(4),
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    # ---------- 新浪单只 ----------
    def _fetch_sina(self, code):
        code_pure = code.split('.')[0]
        q_code = self._t_code(code_pure)
        url = f'http://hq.sinajs.cn/list={q_code}'
        try:
            req = request.Request(url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
                'Referer': 'http://finance.sina.com.cn',
            })
            with request.urlopen(req, timeout=3) as resp:
                raw = resp.read()
            text = raw.decode('gbk', errors='replace')
            return self._parse_sina(text, code_pure)
        except Exception:
            return None

    def _parse_sina(self, text, code_pure):
        m = re.search(r'="(.+)"', text)
        if not m:
            return None
        fields = m.group(1).split(',')
        if len(fields) < 32:
            return None

        def _f(i):
            try:
                return float(fields[i]) if fields[i] else 0.0
            except ValueError:
                return 0.0
        price = _f(3)
        if price <= 0:
            return None
        return {
            'code': code_pure,
            'price': price,
            'open': _f(1),
            'high': _f(4),
            'low': _f(5),
            'volume': int(_f(8)),
            'prev_close': _f(2),
            'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        }

    # ---------- 内部 ----------
    @staticmethod
    def _t_code(code_pure):
        if code_pure.startswith(('60', '68')):
            return f'sh{code_pure}'
        return f'sz{code_pure}'

    def _update_counter(self, success):
        with self._lock:
            if success:
                self._fail_count = 0
                self._last_success_time = time.time()
            else:
                self._fail_count += 1
                if self._fail_count >= self._max_failures:
                    print(f"[RealtimeQuoteFetcher] 连续失败 {self._fail_count} 次，数据源可能不可用")
