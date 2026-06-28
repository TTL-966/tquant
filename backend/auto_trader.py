"""自动下单模块：基类 + pyautogui 实现 + easytrader 实现。"""

import threading
import time
import uuid
from datetime import datetime, time as dt_time

from PySide6.QtCore import QObject, Signal

from backend.auto_trade_config import (
    load_auto_trade_config, save_auto_trade_config,
    set_auto_confirm_until, is_auto_confirm_valid
)
from backend.auto_trade_logger import log_order_to_db, log_order_to_file


class AutoTraderBase(QObject):
    """自动下单基类。"""

    notification = Signal(dict)
    request_confirm = Signal(dict)

    def __init__(self, config, db_engine):
        super().__init__()
        self.config = config
        self.db_engine = db_engine
        self.enabled = config.get('enabled', False)
        self.emergency_stop = config.get('emergency_stop', False)
        self.risk = config.get('risk', {})
        self._pending_orders = {}
        self._lock = threading.Lock()

    @property
    def mode_name(self):
        return 'base'

    def need_confirm(self):
        if is_auto_confirm_valid(self.config):
            return False
        return True

    def save_auto_confirm_setting(self, days=30):
        until = set_auto_confirm_until(days)
        self.config['auto_confirm_until'] = until

    def _check_risk(self, stock_code, action, price, volume):
        """风控检查，返回 (allowed: bool, reason: str)。"""
        if self.emergency_stop:
            return False, "紧急停止已激活"

        allowed_actions = self.risk.get('allowed_actions', ['buy', 'sell'])
        if action not in allowed_actions:
            return False, f"不允许的操作类型: {action}"

        max_amount = self.risk.get('max_amount_per_order', 50000)
        amount = price * volume
        if amount > max_amount:
            return False, f"单笔金额 {amount:.2f} 超过上限 {max_amount}"

        max_vol = self.risk.get('max_volume_per_order', 10000)
        if volume > max_vol:
            return False, f"单笔数量 {volume} 超过上限 {max_vol}"

        if self.risk.get('trading_hours_only', True):
            if not self._is_trading_hours():
                return False, "当前非交易时段"

        return True, ""

    @staticmethod
    def _is_trading_hours():
        now = datetime.now()
        if now.weekday() >= 5:
            return False
        morning_start = dt_time(9, 30)
        morning_end = dt_time(11, 30)
        afternoon_start = dt_time(13, 0)
        afternoon_end = dt_time(15, 0)
        t = now.time()
        return (morning_start <= t <= morning_end) or (afternoon_start <= t <= afternoon_end)

    def execute_order(self, stock_code, action, price, volume):
        """对外入口：风控 → 确认 → 执行。"""
        order_id = str(uuid.uuid4())[:8]

        if not self.enabled:
            log_order_to_file(f"[{order_id}] 自动下单未启用，跳过 {stock_code} {action}")
            return

        if self.emergency_stop:
            msg = f"紧急停止已激活，拒绝下单 {stock_code} {action}"
            log_order_to_file(f"[{order_id}] {msg}", 'WARNING')
            self.notification.emit({
                "type": "order_rejected",
                "order_id": order_id,
                "stock_code": stock_code,
                "action": action,
                "price": price,
                "volume": volume,
                "message": msg,
            })
            return

        allowed, reason = self._check_risk(stock_code, action, price, volume)
        if not allowed:
            log_order_to_file(f"[{order_id}] 风控拒绝: {reason}", 'WARNING')
            log_order_to_db(self.db_engine, stock_code, action, price, volume,
                            'rejected', reason, self.mode_name, order_id)
            self.notification.emit({
                "type": "order_rejected",
                "order_id": order_id,
                "stock_code": stock_code,
                "action": action,
                "price": price,
                "volume": volume,
                "message": reason,
            })
            return

        order_info = {
            "order_id": order_id,
            "stock_code": stock_code,
            "action": action,
            "price": price,
            "volume": volume,
            "message": f"{'买入' if action == 'buy' else '卖出'} {stock_code} {volume}股 @{price:.2f}",
        }

        if self.need_confirm():
            with self._lock:
                self._pending_orders[order_id] = order_info
            self.request_confirm.emit(order_info)
        else:
            self._do_execute_and_log(order_info)

    def confirm_response(self, order_id, confirmed, dont_ask_again=False):
        """处理前端确认响应。"""
        if dont_ask_again:
            self.save_auto_confirm_setting(30)

        with self._lock:
            order_info = self._pending_orders.pop(order_id, None)

        if order_info is None:
            return

        if confirmed:
            self._do_execute_and_log(order_info)
        else:
            log_order_to_db(self.db_engine,
                            order_info['stock_code'], order_info['action'],
                            order_info['price'], order_info['volume'],
                            'cancelled', '用户取消', self.mode_name, order_id)
            self.notification.emit({
                "type": "order_cancelled",
                "order_id": order_id,
                "stock_code": order_info['stock_code'],
                "action": order_info['action'],
                "message": "用户取消下单",
            })

    def _do_execute_and_log(self, order_info):
        """执行下单 + 记录日志 + 发送通知。"""
        order_id = order_info['order_id']
        stock_code = order_info['stock_code']
        action = order_info['action']
        price = order_info['price']
        volume = order_info['volume']

        try:
            success, msg = self._do_execute(stock_code, action, price, volume)
            status = 'success' if success else 'failed'
            log_order_to_db(self.db_engine, stock_code, action, price, volume,
                            status, msg, self.mode_name, order_id)
            log_order_to_file(
                f"[{order_id}] {stock_code} {action} {volume}股 @{price:.2f} → {status}: {msg}",
                'INFO' if success else 'ERROR'
            )
            self.notification.emit({
                "type": "order_result",
                "order_id": order_id,
                "stock_code": stock_code,
                "action": action,
                "price": price,
                "volume": volume,
                "success": success,
                "message": msg,
            })
        except Exception as e:
            log_order_to_db(self.db_engine, stock_code, action, price, volume,
                            'failed', str(e), self.mode_name, order_id)
            log_order_to_file(f"[{order_id}] 异常: {e}", 'ERROR')
            self.notification.emit({
                "type": "order_result",
                "order_id": order_id,
                "stock_code": stock_code,
                "action": action,
                "price": price,
                "volume": volume,
                "success": False,
                "message": str(e),
            })

    def _do_execute(self, stock_code, action, price, volume):
        """子类实现具体下单逻辑，返回 (success: bool, message: str)。"""


        raise NotImplementedError


class PyAutoGUITrader(AutoTraderBase):
    """使用 pyautogui 模拟鼠标键盘操作外部交易软件下单。"""

    @property
    def mode_name(self):
        return 'pyautogui'

    def __init__(self, config, db_engine):
        super().__init__(config, db_engine)
        self.pyautogui_config = config.get('pyautogui', {})

    # ---------- 图像识别核心 ----------
    def _get_window_region(self):
        """获取目标窗口的屏幕区域 (left, top, width, height)，失败返回 None。"""
        try:
            import pygetwindow as gw
        except ImportError:
            return None

        window_title = self.pyautogui_config.get('window_title', '')
        if not window_title:
            return None

        windows = gw.getWindowsWithTitle(window_title)
        if not windows:
            log_order_to_file(f"_get_window_region: 未找到窗口 '{window_title}'", 'WARNING')
            return None

        win = windows[0]
        region = (win.left, win.top, win.width, win.height)
        log_order_to_file(
            f"_get_window_region: 窗口 '{window_title}' 区域 left={win.left} top={win.top} "
            f"width={win.width} height={win.height}"
        )
        return region

    def _locate_button(self, image_path, description='按钮', max_retries=3, retry_delay=0.5):
        """在目标窗口区域内定位图片，支持自适应置信度和重试。

        返回 (x, y) 坐标或 None。
        """
        import pyautogui

        if not image_path or not self._image_exists(image_path):
            log_order_to_file(f"_locate_button: 图片不存在 '{image_path}'", 'WARNING')
            return None

        region = self._get_window_region()
        if region is None:
            log_order_to_file(
                f"_locate_button: 无法获取窗口区域，将全屏搜索",
                'WARNING'
            )

        confidence_levels = self.pyautogui_config.get(
            'confidence_levels', [0.8, 0.7, 0.6, 0.5]
        )

        for attempt in range(1, max_retries + 1):
            for conf in confidence_levels:
                t0 = time.time()
                try:
                    if region:
                        loc = pyautogui.locateCenterOnScreen(
                            image_path, confidence=conf, region=region
                        )
                    else:
                        loc = pyautogui.locateCenterOnScreen(
                            image_path, confidence=conf
                        )
                    elapsed = (time.time() - t0) * 1000
                except Exception as e:
                    log_order_to_file(
                        f"_locate_button [{description}] 尝试{attempt} 置信度{conf:.1f}: "
                        f"异常 {e}",
                        'WARNING'
                    )
                    continue

                if loc is not None:
                    log_order_to_file(
                        f"_locate_button [{description}] ✓ 成功: 位置({loc.x},{loc.y}) "
                        f"置信度{conf:.1f} 尝试{attempt}/{max_retries} 耗时{elapsed:.0f}ms"
                    )
                    return (loc.x, loc.y)
                else:
                    log_order_to_file(
                        f"_locate_button [{description}] 尝试{attempt} 置信度{conf:.1f}: "
                        f"未匹配 耗时{elapsed:.0f}ms"
                    )

            if attempt < max_retries:
                log_order_to_file(
                    f"_locate_button [{description}] 所有置信度均失败，"
                    f"等待 {retry_delay}s 后重试 ({attempt}/{max_retries})"
                )
                time.sleep(retry_delay)
                # 刷新窗口激活状态
                self._activate_window()

        log_order_to_file(
            f"_locate_button [{description}] ✗ 失败: {max_retries}次重试均未找到",
            'ERROR'
        )
        return None

    def _activate_window(self):
        """激活目标窗口，返回 True/False。"""
        window_title = self.pyautogui_config.get('window_title', '')
        if not window_title:
            return False
        try:
            import pygetwindow as gw
            windows = gw.getWindowsWithTitle(window_title)
            if windows:
                win = windows[0]
                if win.isMinimized:
                    win.restore()
                win.activate()
                time.sleep(0.3)
                return True
            return False
        except Exception:
            return False

    # ---------- 下单执行 ----------
    def _do_execute(self, stock_code, action, price, volume):
        try:
            import pyautogui
            import pygetwindow as gw
        except ImportError as e:
            return False, f"缺少依赖: {e}"

        window_title = self.pyautogui_config.get('window_title', '')
        use_image = self.pyautogui_config.get('use_image_recognition', False)

        # 1. 激活窗口
        if window_title:
            try:
                windows = gw.getWindowsWithTitle(window_title)
                if windows:
                    win = windows[0]
                    if win.isMinimized:
                        win.restore()
                    win.activate()
                    time.sleep(0.5)
                else:
                    return False, f"未找到窗口: {window_title}"
            except Exception as e:
                return False, f"激活窗口失败: {e}"

        # 2. 按快捷键打开委托窗口
        if action == 'buy':
            pyautogui.press('f1')
        else:
            pyautogui.press('f2')
        time.sleep(0.8)

        # 3. 点击买入/卖出按钮（绝对坐标）
        if action == 'buy':
            btn_pos = self.pyautogui_config.get('buy_button_pos')
        else:
            btn_pos = self.pyautogui_config.get('sell_button_pos')

        if not btn_pos or len(btn_pos) != 2:
            return False, "未配置买卖按钮坐标"

        pyautogui.click(btn_pos[0], btn_pos[1])
        time.sleep(0.3)

        # 4. 填写股票代码
        code_pos = self.pyautogui_config.get('code_input_pos')
        if code_pos and len(code_pos) == 2:
            pyautogui.click(code_pos[0], code_pos[1])
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            pyautogui.write(stock_code)
            time.sleep(0.2)

        # 5. 填写价格
        price_pos = self.pyautogui_config.get('price_input_pos')
        if price_pos and len(price_pos) == 2:
            pyautogui.click(price_pos[0], price_pos[1])
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            pyautogui.write(str(price))
            time.sleep(0.2)

        # 6. 填写数量
        vol_pos = self.pyautogui_config.get('volume_input_pos')
        if vol_pos and len(vol_pos) == 2:
            pyautogui.click(vol_pos[0], vol_pos[1])
            pyautogui.hotkey('ctrl', 'a')
            pyautogui.press('backspace')
            pyautogui.write(str(volume))
            time.sleep(0.2)

        # 7. 按回车提交（跳过可能的确认弹窗）
        pyautogui.press('enter')
        time.sleep(0.5)

        # 8. 如果弹出确认对话框，点击"是"
        confirm_yes_pos = self.pyautogui_config.get('confirm_yes_pos')
        if confirm_yes_pos and len(confirm_yes_pos) == 2:
            time.sleep(0.3)
            pyautogui.click(confirm_yes_pos[0], confirm_yes_pos[1])
            time.sleep(0.2)

        # 9. 错误弹窗处理 (如: 证券持有数量不足)
        error_ok_pos = self.pyautogui_config.get('error_ok_pos')
        if error_ok_pos and len(error_ok_pos) == 2 and (error_ok_pos[0] > 0 or error_ok_pos[1] > 0):
            time.sleep(0.8)
            pyautogui.click(error_ok_pos[0], error_ok_pos[1])
            log_order_to_file(
                f"Error dialog OK clicked @({error_ok_pos[0]},{error_ok_pos[1]})",
                'WARNING'
            )
            self.notification.emit({
                "type": "order_error",
                "order_id": "",
                "stock_code": stock_code,
                "action": action,
                "price": price,
                "volume": volume,
                "message": f"{'buy' if action == 'buy' else 'sell'} failed: position/funds insufficient, error dialog closed",
            })

        return True, f"坐标下单完成: {stock_code} {'买入' if action == 'buy' else '卖出'} {volume}股 @{price:.2f}"

    @staticmethod
    def _image_exists(path):
        import os
        return os.path.exists(path)


class EasyTrader(AutoTraderBase):
    """使用 easytrader 库通过券商 API 后台下单。"""

    @property
    def mode_name(self):
        return 'easytrader'

    def __init__(self, config, db_engine):
        super().__init__(config, db_engine)
        self.easytrader_config = config.get('easytrader', {})
        self._client = None
        self._client_lock = threading.Lock()

    def _get_client(self):
        if self._client is not None:
            return self._client
        with self._client_lock:
            if self._client is not None:
                return self._client
            try:
                import easytrader
                broker = self.easytrader_config.get('broker', 'ht_client')
                config_path = self.easytrader_config.get('config_path', 'ht.json')

                if not config_path or not os.path.exists(config_path):
                    # 尝试使用 mock 模式
                    log_order_to_file("easytrader 配置文件不存在，使用 mock 模式", 'WARNING')
                    user = easytrader.use(broker)
                    user.prepare(config_path if os.path.exists(config_path) else None)
                else:
                    user = easytrader.use(broker)
                    user.prepare(config_path)

                self._client = user
                return self._client
            except ImportError:
                raise RuntimeError("请安装 easytrader: pip install easytrader")
            except Exception as e:
                raise RuntimeError(f"easytrader 初始化失败: {e}")

    def _do_execute(self, stock_code, action, price, volume):
        import os
        try:
            client = self._get_client()
        except Exception as e:
            return False, str(e)

        try:
            if action == 'buy':
                result = client.buy(stock_code, price=price, amount=volume)
            else:
                result = client.sell(stock_code, price=price, amount=volume)

            if result and isinstance(result, dict):
                if result.get('message') and 'error' in str(result.get('message', '')).lower():
                    return False, str(result.get('message', '未知错误'))
                return True, str(result.get('message', '下单成功'))
            return True, f"easytrader 下单完成: {stock_code} {'买入' if action == 'buy' else '卖出'} {volume}股"
        except Exception as e:
            return False, f"easytrader 下单异常: {e}"


def create_auto_trader(db_engine):
    """根据配置创建对应的 AutoTrader 实例。"""
    config = load_auto_trade_config()
    mode = config.get('mode', 'pyautogui')

    if mode == 'easytrader':
        trader = EasyTrader(config, db_engine)
    else:
        trader = PyAutoGUITrader(config, db_engine)

    return trader
