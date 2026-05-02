from PySide6.QtCore import QObject, Slot

class WebBridge(QObject):
    def __init__(self, parent=None):
        super().__init__(parent)

    @Slot(str, result=str)
    def echo(self, message):
        """用于测试通信的槽函数"""
        return f"Echo: {message}"
