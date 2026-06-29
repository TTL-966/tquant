# -*- mode: python ; coding: utf-8 -*-
"""
Tquant 量化工作站 PyInstaller 打包配置
打包命令: pyinstaller --clean Tquant.spec

安装说明：
  1. 打包后 dist/Tquant/ 文件夹即为可分发程序包
  2. 用户将 tquant.db（及附属 tquant.db-shm, tquant.db-wal）放在 Tquant.exe 同级目录
  3. 双击 Tquant.exe 启动
  4. 如果启动时提示缺少数据库，会在程序所在目录查找，确认文件放置正确即可
"""

import sys
import os as _os
from pathlib import Path
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

# ----- 项目根目录 -----
# pyinstaller 从项目根目录执行，spec 文件也在根目录
ROOT = Path.cwd()
print(f"[SPEC] ROOT={ROOT}")

# ----- 静态资源（复制到 exe 同级目录）-----
datas = [
    (str(ROOT / 'Tquant.html'), '.'),
    (str(ROOT / 'echarts.min.js'), '.'),
    (str(ROOT / 'js'), 'js'),
    (str(ROOT / 'img'), 'img'),
    (str(ROOT / 'resources'), 'resources'),
    (str(ROOT / 'strategies'), 'strategies'),
    (str(ROOT / 'config.json'), '.'),
]

# ----- 收集 akshare 数据文件 -----
try:
    akshare_datas = collect_data_files('akshare')
    datas += akshare_datas
    print(f"[SPEC] 收集到 {len(akshare_datas)} 个 akshare 数据文件")
except Exception as e:
    print(f"[SPEC] WARN: 收集 akshare 数据失败: {e}")

# ----- 收集 PySide6 运行时文件（Qt DLL, plugins, translations, resources）-----
# 注意：PySide6 >= 6.5 后 QtWebEngineProcess.exe 在 Qt/bin/ 下自动被 PyInstaller hook 收集
try:
    import PySide6
    pyside6_base = Path(PySide6.__file__).parent

    # Qt/bin — QtWebEngineProcess.exe, Qt6WebEngineCore.dll 等
    qt_bin = pyside6_base / 'Qt' / 'bin'
    if qt_bin.exists():
        datas.append((str(qt_bin), 'PySide6/Qt/bin'))
        print(f"[SPEC] 收集 Qt/bin: {qt_bin}")

    # Qt/plugins — 图像格式、平台插件等
    qt_plugins = pyside6_base / 'Qt' / 'plugins'
    if qt_plugins.exists():
        datas.append((str(qt_plugins), 'PySide6/Qt/plugins'))

    # Qt/translations
    qt_translations = pyside6_base / 'Qt' / 'translations'
    if qt_translations.exists():
        datas.append((str(qt_translations), 'PySide6/Qt/translations'))

    # Qt/resources
    qt_resources = pyside6_base / 'Qt' / 'resources'
    if qt_resources.exists():
        datas.append((str(qt_resources), 'PySide6/Qt/resources'))

    # 同时收集 PySide6 自身的包数据（hooked by default, but be safe）
    pyside6_pkg_data = collect_data_files('PySide6')
    for src, dst in pyside6_pkg_data:
        # 避免重复添加已收集的目录
        if not any(d[0] == src for d in datas):
            datas.append((src, dst))
    print(f"[SPEC] 收集到 {len(pyside6_pkg_data)} 个 PySide6 包数据条目")
except Exception as e:
    print(f"[SPEC] WARN: 收集 PySide6 数据时出错: {e}")

# ----- 隐藏导入 -----
hiddenimports = [
    # PySide6
    'PySide6.QtCore',
    'PySide6.QtGui',
    'PySide6.QtWidgets',
    'PySide6.QtWebEngineWidgets',
    'PySide6.QtWebChannel',
    'PySide6.QtWebEngineCore',
    'PySide6.QtWebEngineQuick',
    'PySide6.QtNetwork',
    'PySide6.QtPrintSupport',
    'PySide6.QtSvg',
    'PySide6.QtSvgWidgets',
    'PySide6.QtWebEngine',
    'PySide6.QtOpenGL',
    'PySide6.QtOpenGLWidgets',
    # 数据库
    'sqlalchemy',
    'sqlalchemy.dialects.sqlite',
    'sqlalchemy.pool',
    # 科学计算
    'numpy',
    'numpy.core._methods',
    'numpy.lib.format',
    'numpy.random._generator',
    'pandas',
    'pandas.io.sql',
    # akshare 所有子模块
    'akshare',
    # curl_cffi
    'curl_cffi',
    # 自动交易
    'pyautogui',
    'pyscreeze',
    'pynput',
    'pynput.keyboard._win32',
    'pynput.mouse._win32',
    'keyboard',
    'keyboard._winkeyboard',
    # 数据源
    'tushare',
    'baostock',
    # 报表
    'openpyxl',
    'reportlab',
    'reportlab.graphics',
    'reportlab.pdfbase',
    # 系统
    'ctypes',
    'win32api',
    'win32gui',
    'win32con',
    'win32clipboard',
    'pywintypes',
    'pythoncom',
    # Python 标准库（部分可能被 tree-shaking 遗漏）
    'urllib.parse',
    'urllib.request',
    'xml.etree.ElementTree',
    'html.parser',
    'http.client',
    'email.mime.multipart',
    'email.mime.text',
]

# ----- 排除模块（减小体积）-----
excludes = [
    'tkinter',
    '_tkinter',
    'matplotlib',
    'matplotlib.backends',
    'scipy',
    'PIL',
    'Pillow',
    'cv2',
    'opencv',
    'notebook',
    'jupyter',
    'ipykernel',
    'ipython',
    'traitlets',
    'nbformat',
    'nbconvert',
    'jupyter_client',
    'jupyter_core',
    'tornado',
    'zmq',
    'pygments',
    'prompt_toolkit',
    'debugpy',
    'parso',
    'jedi',
    'sphinx',
    'docutils',
    'pytest',
    'setuptools',
    'pip',
    'wheel',
]

# ----- Analysis -----
a = Analysis(
    ['app/main_window.py'],
    pathex=[str(ROOT)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=excludes,
    noarchive=False,
    optimize=0,
)

# ----- 剔除系统 DLL（Windows 自带，打包进去反被 Defender 拦截）-----
_SYS_DLL_PREFIXES = (
    'CONCRT140', 'MSVCP140', 'VCRUNTIME140', 'VCRUNTIME140_1',
    'api-ms-win-', 'ext-ms-win-',
)
a.binaries = [
    b for b in a.binaries
    if not any(b[0].startswith(p) for p in _SYS_DLL_PREFIXES)
]

# ----- PYZ（Python 字节码打包）-----
pyz = PYZ(a.pure)

# ----- EXE -----
exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name='Tquant',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=False,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=str(ROOT / 'img' / '量化交易金融LOGO设计_1_.ico'),
)

# ----- COLLECT（收集到 dist/Tquant 目录，即 --onedir 输出）-----
coll = COLLECT(
    exe,
    a.binaries,
    a.datas,
    strip=False,
    upx=False,
    upx_exclude=[],
    name='Tquant',
)
