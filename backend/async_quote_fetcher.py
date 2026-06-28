"""Async quote fetcher: aiohttp + Tencent/Sina dual-source, semaphore-controlled concurrency."""

import re
import asyncio
import aiohttp
from datetime import datetime


class AsyncQuoteFetcher:
    """Dual-source async quote fetcher. Tencent first, Sina fallback."""

    def __init__(self, max_concurrency=20, request_timeout=3.0):
        self._semaphore = asyncio.Semaphore(max_concurrency)
        self._timeout = aiohttp.ClientTimeout(total=request_timeout)
        self._session = None
        self._fail_count = 0
        self._max_failures = 5

    async def _get_session(self):
        if self._session is None or self._session.closed:
            connector = aiohttp.TCPConnector(
                limit=50,
                limit_per_host=20,
                ttl_dns_cache=300,
            )
            self._session = aiohttp.ClientSession(
                connector=connector,
                timeout=self._timeout,
            )
        return self._session

    async def close(self):
        if self._session and not self._session.closed:
            await self._session.close()

    # ── public API ──

    async def fetch_quote(self, code):
        """Fetch single stock quote. Returns dict or None."""
        code_pure = code.split('.')[0]
        result = await self._fetch_tencent(code_pure)
        if result is None:
            result = await self._fetch_sina(code_pure)
        self._update_counter(result is not None)
        return result

    async def fetch_quotes(self, codes, batch_size=50):
        """Concurrent batch fetch via asyncio.gather + semaphore.
        Returns {code_pure: {price, open, high, low, volume, prev_close, ...}}.
        """
        codes_pure = [c.split('.')[0] for c in codes]
        if not codes_pure:
            return {}

        # Batch Tencent requests (up to 50 per URL)
        batches = [
            codes_pure[i:i + batch_size]
            for i in range(0, len(codes_pure), batch_size)
        ]

        result = {}
        session = await self._get_session()

        # Fetch all batches concurrently
        batch_tasks = [
            self._fetch_tencent_batch_async(session, batch)
            for batch in batches
        ]
        batch_results = await asyncio.gather(*batch_tasks, return_exceptions=True)

        for batch, batch_result in zip(batches, batch_results):
            if isinstance(batch_result, Exception):
                batch_result = {}
            if batch_result:
                result.update(batch_result)

        # Sina fallback for missing codes (concurrent, semaphore-limited)
        missing = [c for c in codes_pure if c not in result]
        if missing:
            sina_tasks = [self._fetch_sina_with_semaphore(session, c) for c in missing]
            sina_results = await asyncio.gather(*sina_tasks, return_exceptions=True)
            for c, r in zip(missing, sina_results):
                if r and not isinstance(r, Exception):
                    result[c] = r

        return result

    # ── Tencent ──

    async def _fetch_tencent(self, code_pure):
        session = await self._get_session()
        q_code = self._t_code(code_pure)
        url = f'https://web.sqt.gtimg.cn/q={q_code}'
        try:
            async with self._semaphore:
                async with session.get(url) as resp:
                    text = await resp.text(encoding='gbk', errors='replace')
            return self._parse_tencent(text, code_pure)
        except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeDecodeError):
            return None

    async def _fetch_tencent_batch_async(self, session, codes_pure):
        """Fetch batch from Tencent (up to ~50 codes per URL)."""
        if not codes_pure:
            return {}
        q_codes = ','.join(self._t_code(c) for c in codes_pure)
        url = f'https://web.sqt.gtimg.cn/q={q_codes}'
        try:
            async with self._semaphore:
                async with session.get(url) as resp:
                    text = await resp.text(encoding='gbk', errors='replace')
            return self._parse_tencent_batch(text)
        except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeDecodeError):
            return {}

    # ── Sina ──

    async def _fetch_sina_with_semaphore(self, session, code_pure):
        async with self._semaphore:
            return await self._fetch_sina_inner(session, code_pure)

    async def _fetch_sina(self, code_pure):
        session = await self._get_session()
        async with self._semaphore:
            return await self._fetch_sina_inner(session, code_pure)

    async def _fetch_sina_inner(self, session, code_pure):
        q_code = self._t_code(code_pure)
        url = f'http://hq.sinajs.cn/list={q_code}'
        try:
            async with session.get(url) as resp:
                text = await resp.text(encoding='gbk', errors='replace')
            return self._parse_sina(text, code_pure)
        except (aiohttp.ClientError, asyncio.TimeoutError, UnicodeDecodeError):
            return None

    # ── Parsers (identical logic to sync version) ──

    def _parse_tencent(self, text, code_pure):
        m = re.search(r'="(.+)"', text)
        if not m:
            return None
        fields = m.group(1).split('~')
        if len(fields) < 38:
            return None
        return self._parse_tencent_fields(fields, code_pure)

    def _parse_tencent_batch(self, text):
        results = {}
        for line in text.strip().split('\n'):
            m = re.search(r'_(\w+?)="(.+)"', line)
            if not m:
                continue
            prefix_code = m.group(1)
            fields = m.group(2).split('~')
            if len(fields) < 38:
                continue
            code_pure = prefix_code[2:]
            parsed = self._parse_tencent_fields(fields, code_pure)
            if parsed:
                results[code_pure] = parsed
        return results

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

    # ── Internal ──

    @staticmethod
    def _t_code(code_pure):
        if code_pure.startswith(('60', '68')):
            return f'sh{code_pure}'
        return f'sz{code_pure}'

    def _update_counter(self, success):
        if success:
            self._fail_count = 0
        else:
            self._fail_count += 1
            if self._fail_count >= self._max_failures:
                print(f"[AsyncQuoteFetcher] {self._fail_count} consecutive failures, source may be down")
