import os
os.environ["QT_QPA_PLATFORM"] = "windows:software"
os.environ["QTWEBENGINE_DISABLE_SANDBOX"] = "1"

import sys
from PySide6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QWidget, QMenu
from PySide6.QtGui import QShortcut, QKeySequence
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage
from PySide6.QtCore import QUrl
from app.web_bridge import WebBridge
from backend.data_updater import DataUpdateScheduler

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
        # 关闭OpenGL相关功能以减少崩溃
        settings = self.web_view.settings()
        settings.setAttribute(settings.WebAttribute.Accelerated2dCanvasEnabled, False)
        settings.setAttribute(settings.WebAttribute.WebGLEnabled, False)
        layout.addWidget(self.web_view)

        self.channel = QWebChannel()
        self.bridge = WebBridge()
        self.bridge.main_window = self
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        base_dir = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(base_dir, "..", "Tquant.html")  # 注意路径
        self.web_view.setUrl(QUrl.fromLocalFile(os.path.abspath(html_path)))

        # 数据更新调度器
        self.scheduler = DataUpdateScheduler(self.bridge.db.engine)
        self.scheduler.update_started.connect(self.on_update_started)
        self.scheduler.update_finished.connect(self.on_update_finished)
        self.scheduler.start()

        # F12 快捷键
        shortcut = QShortcut(QKeySequence("F12"), self)
        shortcut.activated.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))

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
