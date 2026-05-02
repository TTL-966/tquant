import os
from PySide6.QtCore import Qt, QUrl, QObject, Slot
from PySide6.QtWidgets import QMainWindow, QVBoxLayout, QWidget, QShortcut, QMenu
from PySide6.QtGui import QKeySequence, QAction
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtWebEngineCore import QWebEnginePage
from app.web_bridge import WebBridge

class MainWindow(QMainWindow):
    def __init__(self):
        super().__init__()
        self.setWindowTitle("Tquant 量化工作站")
        self.resize(1480, 900)

        # 中心部件
        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)

        # WebView
        self.web_view = QWebEngineView()
        layout.addWidget(self.web_view)

        # 设置 QWebChannel
        self.channel = QWebChannel()
        self.bridge = WebBridge()
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        # 加载项目根目录下的 Tquant.html（而不是 web/index.html）
        base_dir = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(base_dir, "..", "Tquant.html")
        self.web_view.setUrl(QUrl.fromLocalFile(os.path.abspath(html_path)))

        # ---------- 新增：开发者工具快捷键 ----------
        shortcut = QShortcut(QKeySequence("F12"), self)
        shortcut.activated.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))

        # 启用自定义右键菜单（含“检查”选项）
        self.web_view.setContextMenuPolicy(Qt.CustomContextMenu)
        self.web_view.customContextMenuRequested.connect(self._show_context_menu)

    # ---------- 新增：自定义右键菜单 ----------
    def _show_context_menu(self, pos):
        menu = QMenu(self)
        inspect_action = menu.addAction("检查")
        inspect_action.triggered.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))
        menu.exec(self.web_view.mapToGlobal(pos))
