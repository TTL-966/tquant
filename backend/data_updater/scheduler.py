import os
import sys
import subprocess
import threading
from datetime import datetime, timedelta

from PySide6.QtCore import QObject, QTimer, Signal

from .daily_kline_updater import StockDailyUpdater as DailyKlineUpdater
from .financial_updater import FinancialUpdater
from .index_updater_akshare import IndexComponentUpdater

class DataUpdateScheduler(QObject):
    """数据更新调度器，使用 QTimer + 独立子进程，避免 Baostock 与 QtWebEngine 冲突"""
    update_started = Signal(str)
    update_finished = Signal(str, bool, str)

    def __init__(self, db_engine):
        super().__init__()
        self.db_engine = db_engine
        self._update_process = None
        self._financial_process = None
        self._fund_flow_process = None

        self._daily_timer = None
        self._financial_timer = None

        temp_updater = DailyKlineUpdater(db_engine)
        temp_updater._release_lock()
        QTimer.singleShot(10000, self._check_index_update)
        # 资金流向：启动 10 秒后首次更新，之后每日 18:00
        QTimer.singleShot(10000, self._run_fund_flow_update)

    def _schedule_daily(self):
        """计算到下一个 18:00 的毫秒数并启动定时器"""
        now = datetime.now()
        next_run = now.replace(hour=18, minute=0, second=0, microsecond=0)
        if now >= next_run:
            next_run += timedelta(days=1)
        interval_ms = int((next_run - now).total_seconds() * 1000)
        self._daily_timer.start(interval_ms)

    def _scheduled_check(self):
        """每日定时触发：先重置定时器为每天一次，再执行检查"""
        self._daily_timer.stop()
        self._daily_timer.start(24 * 60 * 60 * 1000)  # 之后每 24 小时触发一次
        self._check_and_update()

    def _check_and_update(self):
        """检查是否需要更新，如果需要则启动子进程"""
        if self._update_process is not None and self._update_process.poll() is None:
            return  # 已有更新进程在运行

        updater = DailyKlineUpdater(self.db_engine)
        if not updater.needs_update():
            return

        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        script_path = os.path.join(base_dir, 'backend', 'standalone_updater.py')
        if not os.path.exists(script_path):
            print(f"[Scheduler] 更新脚本不存在: {script_path}")
            return

        self.update_started.emit("daily_kline")
        try:
            startupinfo = None
            if sys.platform == 'win32':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            self._update_process = subprocess.Popen(
                [sys.executable, script_path, '--quiet'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=startupinfo
            )
            self._read_output()
        except Exception as e:
            self.update_finished.emit("daily_kline", False, str(e))

    def _read_output(self):
        """后台线程读取子进程输出"""
        def read():
            proc = self._update_process
            if proc is None:
                return
            for line in proc.stdout:
                print(f"[Updater] {line.decode('utf-8').strip()}")
            for line in proc.stderr:
                print(f"[Updater Error] {line.decode('utf-8').strip()}")
            proc.wait()
            success = (proc.returncode == 0)
            msg = "更新成功" if success else f"更新失败 (返回码: {proc.returncode})"
            print(f"[Scheduler] 子进程退出，{msg}")
            self.update_finished.emit("daily_kline", success, msg)
            self._update_process = None
        threading.Thread(target=read, daemon=True).start()

    def _check_index_update(self):
        updater = IndexComponentUpdater(self.db_engine)
        if updater.needs_update():
            success, msg = updater._safe_run()
            print(f"指数成分股更新结果: {msg}")

    def _scheduled_financial_check(self):
        """定期检查财务数据是否需要更新"""
        if self._financial_process is not None and self._financial_process.poll() is None:
            return
        updater = FinancialUpdater(self.db_engine)
        if not updater.needs_update():
            return
        self._run_financial_update()

    def _run_financial_update(self):
        """在子进程中执行财务数据更新"""
        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        script_path = os.path.join(base_dir, 'backend', 'standalone_updater.py')
        if not os.path.exists(script_path):
            print(f"[Scheduler] 更新脚本不存在: {script_path}")
            return

        self.update_started.emit("financial")
        try:
            startupinfo = None
            if sys.platform == 'win32':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            self._financial_process = subprocess.Popen(
                [sys.executable, script_path, '--type', 'financial', '--quiet'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=startupinfo
            )
            self._read_financial_output()
        except Exception as e:
            self.update_finished.emit("financial", False, str(e))

    def _read_financial_output(self):
        """后台线程读取财务更新子进程输出"""
        def read():
            proc = self._financial_process
            if proc is None:
                return
            for line in proc.stdout:
                print(f"[FinancialUpdater] {line.decode('utf-8').strip()}")
            for line in proc.stderr:
                print(f"[FinancialUpdater Error] {line.decode('utf-8').strip()}")
            proc.wait()
            success = (proc.returncode == 0)
            msg = "财务数据更新成功" if success else f"财务数据更新失败 (返回码: {proc.returncode})"
            print(f"[Scheduler] 财务更新子进程退出，{msg}")
            self.update_finished.emit("financial", success, msg)
            self._financial_process = None
        threading.Thread(target=read, daemon=True).start()

    # ── 资金流向更新 ──

    def _run_fund_flow_update(self):
        """在子进程中执行资金流向增量更新。"""
        if self._fund_flow_process is not None and self._fund_flow_process.poll() is None:
            return

        base_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        script_path = os.path.join(base_dir, 'backend', 'standalone_updater.py')
        if not os.path.exists(script_path):
            print(f"[Scheduler] 更新脚本不存在: {script_path}")
            return

        self.update_started.emit("fund_flow")
        try:
            startupinfo = None
            if sys.platform == 'win32':
                startupinfo = subprocess.STARTUPINFO()
                startupinfo.dwFlags |= subprocess.STARTF_USESHOWWINDOW
                startupinfo.wShowWindow = subprocess.SW_HIDE
            self._fund_flow_process = subprocess.Popen(
                [sys.executable, script_path, '--type', 'fund_flow', '--days', '5', '--quiet'],
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                startupinfo=startupinfo
            )
            self._read_fund_flow_output()
        except Exception as e:
            self.update_finished.emit("fund_flow", False, str(e))

    def _read_fund_flow_output(self):
        """后台线程读取资金流向更新子进程输出。"""
        def read():
            proc = self._fund_flow_process
            if proc is None:
                return
            for line in proc.stdout:
                print(f"[FundFlowUpdater] {line.decode('utf-8').strip()}")
            for line in proc.stderr:
                print(f"[FundFlowUpdater Error] {line.decode('utf-8').strip()}")
            proc.wait()
            success = (proc.returncode == 0)
            msg = "资金流向更新成功" if success else f"资金流向更新失败 (返回码: {proc.returncode})"
            print(f"[Scheduler] 资金流向更新子进程退出，{msg}")
            self.update_finished.emit("fund_flow", success, msg)
            self._fund_flow_process = None
        threading.Thread(target=read, daemon=True).start()

    def trigger_fund_flow_update(self):
        """手动触发资金流向更新（由 UI 调用）。"""
        if self._fund_flow_process is not None and self._fund_flow_process.poll() is None:
            return
        self._run_fund_flow_update()

    # ── 原有方法 ──

    def trigger_manual_update(self):
        """手动触发 K线更新（由 UI 调用）"""
        if self._update_process is not None and self._update_process.poll() is None:
            return
        self._check_and_update()

    def trigger_financial_update(self):
        """手动触发财务数据更新（由 UI 调用）"""
        if self._financial_process is not None and self._financial_process.poll() is None:
            return
        self._run_financial_update()

    def stop(self):
        """停止调度器"""
        if self._daily_timer is not None:
            self._daily_timer.stop()
        if self._financial_timer is not None:
            self._financial_timer.stop()
        for p in [self._update_process, self._financial_process, self._fund_flow_process]:
            if p is not None and p.poll() is None:
                p.kill()
