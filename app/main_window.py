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
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        base_dir = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(base_dir, "..", "Tquant.html")  # 注意路径
        self.web_view.setUrl(QUrl.fromLocalFile(os.path.abspath(html_path)))

        # F12 快捷键
        shortcut = QShortcut(QKeySequence("F12"), self)
        shortcut.activated.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))

# 入口代码（关键！）
if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())
