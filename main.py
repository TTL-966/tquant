import sys
import os
from PySide6.QtWidgets import QApplication, QMainWindow, QVBoxLayout, QWidget
from PySide6.QtWebEngineWidgets import QWebEngineView
from PySide6.QtWebChannel import QWebChannel
from PySide6.QtCore import QUrl, QObject, Slot
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
        from PySide6.QtWebEngineCore import QWebEngineProfile
        profile = QWebEngineProfile.defaultProfile()
        profile.setHttpCacheType(QWebEngineProfile.NoCache)
        profile.setPersistentStoragePath("")
        print("QtWebEngine 缓存已禁用")
        layout.addWidget(self.web_view)

        self.channel = QWebChannel()
        self.bridge = WebBridge()
        self.channel.registerObject("bridge", self.bridge)
        self.web_view.page().setWebChannel(self.channel)

        base_dir = os.path.dirname(os.path.abspath(__file__))
        html_path = os.path.join(base_dir, "Tquant.html")

        self.web_view.setUrl(QUrl.fromLocalFile(os.path.abspath(html_path)))

if __name__ == "__main__":
    app = QApplication(sys.argv)
    window = MainWindow()
    window.show()
    sys.exit(app.exec())