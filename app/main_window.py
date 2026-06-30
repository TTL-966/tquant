import os
import sys
os.environ["QT_QPA_PLATFORM"] = "windows:software"
os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"

from PySide6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QWidget, QMenu
from PySide6.QtGui import QShortcut, QKeySequence
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage, QWebEngineProfile
from PySide6.QtCore import QUrl, Qt, QTimer
from app.web_bridge import WebBridge
from backend.data_updater import DataUpdateScheduler


def resource_path(relative_path):
    """获取资源文件路径，兼容 PyInstaller 打包和开发模式。

    打包模式策略：
      - 静态资源（Tquant.html, js/, img/, config.json 等）复制到 exe 同级目录
      - Python 模块（backend/, app/）在 _MEIPASS 内部
      - 优先检查 exe 同级目录（用户可修改的静态资源），再回退到 _MEIPASS
    """
    if getattr(sys, 'frozen', False):
        # 打包模式：先查找 exe 同级目录
        exe_dir = os.path.dirname(sys.executable)
        exe_path = os.path.join(exe_dir, relative_path)
        if os.path.exists(exe_path):
            return exe_path
        # 回退到 _MEIPASS（PyInstaller 临时解压目录）
        meipass_path = os.path.join(sys._MEIPASS, relative_path)
        if os.path.exists(meipass_path):
            return meipass_path
        # 都不存在时返回 exe 同级路径（让上层处理文件不存在的情况）
        return exe_path
    else:
        # 开发模式：项目根目录
        base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
        return os.path.join(base, relative_path)



class MainWindow(QMainWindow):
    def __init__(self):

        super().__init__()
        self.setWindowTitle("Tquant 量化工作站")
        self.resize(1400, 900)

        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)

        self.web_view = QWebEngineView()
        self.web_view.page().javaScriptConsoleMessage = lambda level, msg, line, src: print(f"[JS] {msg}")
        # 关闭OpenGL相关功能以减少崩溃
        settings = self.web_view.settings()
        settings.setAttribute(settings.WebAttribute.Accelerated2dCanvasEnabled, False)
        settings.setAttribute(settings.WebAttribute.WebGLEnabled, False)
        layout.addWidget(self.web_view)

        self.channel = QWebChannel()
        self.bridge = WebBridge()
        self.bridge.main_window = self
        self.bridge.web_view = self.web_view
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        print("数据库连接：", self.bridge.db.engine.url)

        # 禁用 QWebEngine 磁盘缓存，确保每次启动加载最新 JS/HTML
        profile = QWebEngineProfile.defaultProfile()
        profile.setHttpCacheType(QWebEngineProfile.HttpCacheType.MemoryHttpCache)
        profile.clearHttpCache()

        html_path = resource_path("Tquant.html")
        self.web_view.setUrl(QUrl.fromLocalFile(os.path.abspath(html_path)))

        # 数据更新调度器（QObject + QTimer，延迟初始化避免阻塞启动）
        self.scheduler = None
        QTimer.singleShot(8000, self._init_scheduler)

        # F12 快捷键
        shortcut = QShortcut(QKeySequence("F12"), self)
        shortcut.activated.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))

        # 全屏请求处理
        self.web_view.page().fullScreenRequested.connect(self.on_fullscreen_requested)
        self.is_fullscreen = False

        # 自动恢复上次未停止的实时策略（延迟 8s，不阻塞 UI）
        QTimer.singleShot(8000, lambda: self.bridge.auto_restore_realtime_strategy())

        # 预加载常用股票K线缓存（延迟 15s，后台线程）
        QTimer.singleShot(15000, lambda: self.bridge._prewarm_kline_cache())

    def _init_scheduler(self):
        self.scheduler = DataUpdateScheduler(self.bridge.db.engine)
        self.scheduler.update_started.connect(self.on_update_started)
        self.scheduler.update_finished.connect(self.on_update_finished)

    def on_fullscreen_requested(self, request):
        request.accept()
        if not self.is_fullscreen:
            self.showFullScreen()
        else:
            self.showNormal()
        self.is_fullscreen = not self.is_fullscreen
        QTimer.singleShot(150, self._resize_webview)

    def _resize_webview(self):
        self.web_view.resize(self.size())
        self.web_view.page().runJavaScript("window.dispatchEvent(new Event('resize'));")

    def resizeEvent(self, event):
        super().resizeEvent(event)
        self.web_view.resize(event.size())
        self.web_view.page().runJavaScript("window.dispatchEvent(new Event('resize'));")
        print(f"[Fullscreen] 窗口尺寸: {self.width()}x{self.height()}")

    def on_update_started(self, name):
        print(f"[DataUpdate] {name} 开始更新")

    def on_update_finished(self, name, success, msg):
        status = "成功" if success else "失败"
        print(f"[DataUpdate] {name} 更新{status}: {msg}")

# 入口代码（关键！）
if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
