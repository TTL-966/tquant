#!/usr/bin/env python
# -*- coding: utf-8 -*-
"""
数据源配置管理模块。
使用项目根目录下的 config.json 存储数据源和 Tushare Token 配置。
"""

import json
import os
import sys
import tempfile
import threading


def get_app_dir():
    """返回应用根目录。
    打包模式：exe 所在目录
    开发模式：项目根目录
    """
    if getattr(sys, 'frozen', False):
        return os.path.dirname(sys.executable)
    return os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def get_progress_path():
    """返回更新进度文件的路径。
    打包模式：临时目录（确保可写）
    开发模式：backend/ 目录下
    """
    if getattr(sys, 'frozen', False):
        return os.path.join(tempfile.gettempdir(), 'tquant_update_progress.json')
    return os.path.join(os.path.dirname(os.path.abspath(__file__)), 'update_progress.json')


_CONFIG_PATH = os.path.join(get_app_dir(), 'config.json')

DEFAULT_CONFIG = {
    "data_source": "baostock",
    "tushare_token": "",
    "idle_update_enabled": True,
    "idle_update_days": 3,
    "update_options": {
        "update_kline": True,
        "update_turnover": False,
        "max_days_back": 0
    }
}

_lock = threading.Lock()


def load_config():
    """读取配置，缺失字段自动补默认值。

    打包环境首次启动：从 config.example.json 复制到 config.json。
    """
    if not os.path.exists(_CONFIG_PATH):
        _example = os.path.join(get_app_dir(), 'config.example.json')
        if os.path.exists(_example):
            import shutil
            shutil.copy(_example, _CONFIG_PATH)
            # 重新读一次，走正常流程
            return load_config()
        return dict(DEFAULT_CONFIG)
    try:
        with open(_CONFIG_PATH, 'r', encoding='utf-8') as f:
            config = json.load(f)
        for key, value in DEFAULT_CONFIG.items():
            if key not in config:
                config[key] = value
        return config
    except Exception:
        return dict(DEFAULT_CONFIG)


def save_config(config):
    """保存配置到 JSON 文件。"""
    with _lock:
        os.makedirs(os.path.dirname(_CONFIG_PATH), exist_ok=True)
        with open(_CONFIG_PATH, 'w', encoding='utf-8') as f:
            json.dump(config, f, indent=2, ensure_ascii=False)


def get_config_path():
    """返回配置文件路径。"""
    return _CONFIG_PATH
