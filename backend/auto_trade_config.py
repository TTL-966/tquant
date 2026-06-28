"""自动下单配置管理：读取/保存 config.json 的 auto_trader 节。"""

import json
import os
import threading
from datetime import datetime, timedelta

_CONFIG_PATH = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    'config.json'
)

DEFAULT_AUTO_TRADE_CONFIG = {
    "enabled": False,
    "mode": "pyautogui",
    "emergency_stop": False,
    "auto_confirm_until": None,
    "risk": {
        "max_amount_per_order": 50000,
        "max_volume_per_order": 10000,
        "trading_hours_only": True,
        "allowed_actions": ["buy", "sell"]
    },
    "pyautogui": {
        "window_title": "网上股票交易系统5.0",
        "buy_button_path": "resources/buy_button.png",
        "sell_button_path": "resources/sell_button.png",
        "confirm_button_path": "resources/confirm.png",
        "ok_button_path": "resources/ok.png",
        "confirm_dialog_yes_path": "resources/confirm_yes.png",
        "confirm_dialog_no_path": "resources/confirm_no.png",
        "code_input_pos": [300, 500],
        "price_input_pos": [400, 530],
        "volume_input_pos": [500, 560],
        "buy_button_pos": [524, 531],
        "sell_button_pos": [541, 528],
        "confirm_yes_pos": [1044, 739],
        "confirm_no_pos": [1196, 745],
        "error_ok_pos": [0, 0],
        "use_image_recognition": True,
        "confidence": 0.8,
        "confidence_levels": [0.8, 0.7, 0.6, 0.5]
    },
    "easytrader": {
        "broker": "ht_client",
        "config_path": "ht.json",
        "account_type": "stock"
    }
}

_lock = threading.Lock()


def load_auto_trade_config():
    """读取 auto_trader 配置节，缺失字段自动补默认值。"""
    full_config = {}
    try:
        if os.path.exists(_CONFIG_PATH):
            with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
                full_config = json.load(f)
    except Exception:
        pass

    saved = full_config.get('auto_trader', {})
    merged = _deep_merge(DEFAULT_AUTO_TRADE_CONFIG, saved)
    return merged


def save_auto_trade_config(updates):
    """更新 auto_trader 配置节并保存。updates 为 dict，会深度合并。"""
    with _lock:
        full_config = {}
        try:
            if os.path.exists(_CONFIG_PATH):
                with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
                    full_config = json.load(f)
        except Exception:
            pass

        current = full_config.get('auto_trader', {})
        merged = _deep_merge(current, updates)
        full_config['auto_trader'] = merged

        os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
        with open(_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(full_config, f, indent=2, ensure_ascii=False)


def set_auto_confirm_until(days=30):
    """设置免确认截止时间并持久化。"""
    until = (datetime.now() + timedelta(days=days)).isoformat()
    save_auto_trade_config({"auto_confirm_until": until})
    return until


def clear_auto_confirm():
    """清除免确认设置。"""
    save_auto_trade_config({"auto_confirm_until": None})


def is_auto_confirm_valid(config=None):
    """检查免确认是否在有效期内。"""
    if config is None:
        config = load_auto_trade_config()
    until_str = config.get('auto_confirm_until')
    if not until_str:
        return False
    try:
        until = datetime.fromisoformat(until_str)
        return datetime.now() < until
    except (ValueError, TypeError):
        return False


def _deep_merge(base, override):
    """深度合并两个 dict，override 的值覆盖 base。"""
    result = dict(base)
    for k, v in override.items():
        if k in result and isinstance(result[k], dict) and isinstance(v, dict):
            result[k] = _deep_merge(result[k], v)
        else:
            result[k] = v
    return result
