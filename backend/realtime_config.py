"""实时策略配置持久化：保存/加载/清除配置文件。"""

import json
import os

_CONFIG_FILENAME = "realtime_strategy_config.json"

def _config_path():
    """配置文件路径：应用根目录（与 tquant.db 同级）。"""
    base = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    return os.path.join(base, _CONFIG_FILENAME)

def save_config(config: dict):
    """保存实时策略配置到 JSON 文件。"""
    with open(_config_path(), 'w', encoding='utf-8') as f:
        json.dump(config, f, ensure_ascii=False, indent=2)

def load_config() -> dict | None:
    """加载实时策略配置，文件不存在时返回 None。"""
    path = _config_path()
    if not os.path.exists(path):
        return None
    try:
        with open(path, 'r', encoding='utf-8') as f:
            return json.load(f)
    except (json.JSONDecodeError, IOError):
        return None

def clear_config():
    """删除配置文件。"""
    path = _config_path()
    if os.path.exists(path):
        os.remove(path)
