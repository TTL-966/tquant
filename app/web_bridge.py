from PySide6.QtCore import QObject, Slot
import json
from backend.data_feed import fetch_kline

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)

    @Slot(str, result=str)
    def echo(self, message):
        return f"Echo: {message}"

    @Slot(str, result=str)
    def getKlineData(self, code):
        try:
            data = fetch_kline(code)
            return json.dumps(data)
        except Exception as e:
            return json.dumps({"error": str(e)})
