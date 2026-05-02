import json
from PyQt5.QtCore import QObject, pyqtSlot
from backend.data_feed import DataFeed

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.data_feed = DataFeed()

    @pyqtSlot(result=str)
    def ping(self):
        return "pong"

    @pyqtSlot(str, result=str)
    def get_kline_data(self, code):
        try:
            return self.data_feed.get_kline_json(code)
        except Exception as e:
            return json.dumps({"error": str(e)})
