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

        central = QWidget()
        self.setCentralWidget(central)
        layout = QVBoxLayout(central)
        layout.setContentsMargins(0, 0, 0, 0)

        self.web_view = QWebEngineView()
        layout.addWidget(self.web_view)

        self.channel = QWebChannel()
        self.bridge = WebBridge()
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        base_dir = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(base_dir, "..", "Tquant.html")
        self.web_view.setUrl(QUrl.fromLocalFile(os.path.abspath(html_path)))

        # F12 开发者工具
        shortcut = QShortcut(QKeySequence("F12"), self)
        shortcut.activated.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))

        # 自定义右键菜单
        self.web_view.setContextMenuPolicy(Qt.CustomContextMenu)
        self.web_view.customContextMenuRequested.connect(self._show_context_menu)

    def _show_context_menu(self, pos):
        menu = QMenu(self)
        inspect_action = menu.addAction("检查")
        inspect_action.triggered.connect(lambda: self.web_view.page().triggerAction(QWebEnginePage.InspectElement))
        menu.exec(self.web_view.mapToGlobal(pos))
