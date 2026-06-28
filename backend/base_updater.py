import time
import traceback
from datetime import datetime


class BaseUpdater:
    """数据更新器基类，所有具体更新器需继承此类"""

    def __init__(self, name: str):
        self.name = name
        self.enabled = True

    def needs_update(self) -> bool:
        """判断是否需要更新。子类必须实现。"""
        raise NotImplementedError

    def run(self) -> tuple:
        """执行更新，返回 (success: bool, message: str)。子类必须实现。"""
        raise NotImplementedError

    def log(self, msg: str, level: str = "INFO"):
        """统一日志输出"""
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        print(f"[{timestamp}] [{self.name}] [{level}] {msg}")

    def _safe_run(self) -> tuple:
        """包装 run 方法，捕获异常并记录"""
        try:
            self.log("开始更新...")
            start = time.time()
            success, msg = self.run()
            elapsed = time.time() - start
            if success:
                self.log(f"更新完成，耗时 {elapsed:.2f} 秒")
            else:
                self.log(f"更新失败: {msg}", "ERROR")
            return success, msg
        except Exception as e:
            self.log(f"更新异常: {str(e)}\n{traceback.format_exc()}", "ERROR")
            return False, str(e)
