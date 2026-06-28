"""
测试自动处理委托确认对话框 + 错误弹窗（如“证券持有数量不足”）
流程：
  1. 打开卖出委托窗口，填写代码/价格/数量（数量 > 可卖数量）
  2. 点击卖出按钮，按回车提交
  3. 等待委托确认对话框，点击“是(Y)”
  4. 等待系统校验，弹出错误弹窗，点击“确定”关闭
"""

import time
import sys
import pyautogui
import pygetwindow as gw

# ========== 坐标配置（请根据你的实际测量修改）==========
WINDOW_TITLE = "网上股票交易系统5.0"
SELL_BTN = (1279, 465)          # 卖出按钮坐标
CODE_POS = (1237, 209)          # 股票代码输入框
PRICE_POS = (1262, 294)         # 价格输入框
VOLUME_POS = (1225, 426)        # 数量输入框
CONFIRM_YES_POS = (1788, 688)   # 委托确认对话框的“是(Y)”按钮坐标（重要！）
ERROR_OK_POS = (1726, 629)      # 错误弹窗“确定”按钮坐标

STOCK_CODE = "603687"           # 测试股票（确保持仓不足）
PRICE = 15.6
VOLUME = "300"                  # 大于实际可卖数量

def log(msg):
    print(f"[{time.strftime('%H:%M:%S')}] {msg}")

def main():
    log("===== 测试委托确认 + 错误弹窗自动关闭 =====")
    input("请确保同花顺已登录，且测试股票持仓不足。按 Enter 开始...")

    # 激活同花顺窗口
    log("激活窗口...")
    windows = gw.getWindowsWithTitle(WINDOW_TITLE)
    if not windows:
        log("未找到同花顺窗口")
        return
    win = windows[0]
    if win.isMinimized:
        win.restore()
    try:
        win.activate()
    except Exception as e:
        log(f"激活异常（忽略）: {e}")
    time.sleep(1)

    # 按 F2 打开卖出委托
    log("按 F2 打开卖出委托...")
    pyautogui.press('f2')
    time.sleep(1.5)

    # 填写股票代码
    log(f"输入代码 {STOCK_CODE}")
    pyautogui.click(CODE_POS)
    pyautogui.hotkey('ctrl', 'a')
    pyautogui.press('backspace')
    pyautogui.write(STOCK_CODE)
    time.sleep(0.3)

    # 填写价格
    log(f"输入价格 {PRICE}")
    time.sleep(0.8)
    pyautogui.click(PRICE_POS)
    time.sleep(0.2)
    pyautogui.hotkey('ctrl', 'a')
    pyautogui.press('backspace')
    pyautogui.write(f"{PRICE:.2f}")  # 现在 PRICE 是浮点数，可以格式化
    time.sleep(0.2)
    pyautogui.press('tab')

    # 填写数量（大于可卖数量）
    log(f"输入数量 {VOLUME}")
    pyautogui.click(VOLUME_POS)
    pyautogui.hotkey('ctrl', 'a')
    pyautogui.press('backspace')
    pyautogui.write(VOLUME)
    time.sleep(0.3)

    # 点击卖出按钮
    log("点击卖出按钮...")
    pyautogui.click(SELL_BTN)
    time.sleep(0.5)

    # 按回车提交（弹出委托确认对话框）
    log("按回车提交委托...")
    pyautogui.press('enter')
    time.sleep(0.8)

    # 【新增】处理委托确认对话框：点击“是(Y)”
    log("处理委托确认对话框，点击“是”...")
    pyautogui.click(CONFIRM_YES_POS[0], CONFIRM_YES_POS[1])
    log("已点击“是”，等待系统校验...")
    time.sleep(1.5)   # 等待校验完成，可能弹出错误弹窗

    # 处理错误弹窗：点击“确定”按钮
    log("尝试关闭可能出现的错误弹窗...")
    if ERROR_OK_POS and len(ERROR_OK_POS) == 2:
        pyautogui.click(ERROR_OK_POS[0], ERROR_OK_POS[1])
        log("已点击错误弹窗的【确定】按钮")
    else:
        log("未配置 error_ok_pos，跳过")

    time.sleep(0.5)
    log("测试完成。如果弹窗已自动关闭，则功能正常。")

if __name__ == "__main__":
    main()