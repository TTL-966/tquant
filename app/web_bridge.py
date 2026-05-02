import json
from PySide6.QtCore import QObject, Slot
from backend.data_feed import DataFeed

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.data_feed = DataFeed()

    @Slot(result=str)
    def ping(self):
        return "pong"

    @Slot(str, result=str)
    def get_kline_data(self, code):
        try:
            return self.data_feed.get_kline_json(code)
        except Exception as e:
            return json.dumps({"error": str(e)})
