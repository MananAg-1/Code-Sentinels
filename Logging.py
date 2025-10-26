import psutil
import win32gui
import win32process
import time
import requests
from datetime import datetime
import sys
import io

# Fix console encoding for Unicode characters
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ==================== CONFIG ====================
SERVER_URL = "http://localhost:3000/api/activity-log"  # Server endpoint for activity logs
POLL_INTERVAL = 1  # seconds between checks
MAX_RETRIES = 3  # retries if request fails

# ==================== HELPER FUNCTIONS ====================
def get_active_window():
    try:
        hwnd = win32gui.GetForegroundWindow()
        _, pid = win32process.GetWindowThreadProcessId(hwnd)
        process = psutil.Process(pid)
        process_name = process.name()
        window_title = win32gui.GetWindowText(hwnd)
        return process_name, window_title
    except Exception:
        return None, None

def send_log(process_name, window_title):
    payload = {
        "timestamp": datetime.now().isoformat(),
        "application": process_name,
        "window": window_title
    }
    for attempt in range(MAX_RETRIES):
        try:
            response = requests.post(SERVER_URL, json=payload, timeout=2)
            if response.status_code == 200:
                return True
        except Exception as e:
            if attempt == MAX_RETRIES - 1:
                print(f"[!] Failed to send log after {MAX_RETRIES} attempts: {e}")
            time.sleep(0.5)
    return False

# ==================== MAIN LOOP ====================
print("[INFO] Application Activity Tracker started.")
print("[INFO] Press Ctrl+C to stop.\n")

last_app, last_title = None, None

try:
    while True:
        process_name, window_title = get_active_window()
        if process_name and window_title:
            # Only log when application/window changes
            if process_name != last_app or window_title != last_title:
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"[{timestamp}] Active App: {process_name} | Window: {window_title}")
                send_log(process_name, window_title)
                last_app, last_title = process_name, window_title
        time.sleep(POLL_INTERVAL)
except KeyboardInterrupt:
    print("\n[INFO] Activity Tracker stopped by user.")
except Exception as e:
    print(f"[ERROR] Unexpected error: {e}")
