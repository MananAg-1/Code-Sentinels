import psutil
import win32gui
import win32process
import time
import requests
from datetime import datetime
import sys
import io
import socket
import getpass

# Fix console encoding for Unicode characters
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

# ==================== CONFIG ====================
SERVER_URL = "http://192.168.137.1:8080/api/activity-log"
HEARTBEAT_URL = "http://192.168.137.1:8080/api/heartbeat"
POLL_INTERVAL = 1
MAX_RETRIES = 3

# Get system info
COMPUTER_NAME = socket.gethostname()
USERNAME = getpass.getuser()

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
        "window": window_title,
        "computer_name": COMPUTER_NAME,
        "username": USERNAME
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

def send_heartbeat():
    """Send heartbeat to server"""
    try:
        payload = {
            "computer_name": COMPUTER_NAME,
            "username": USERNAME,
            "status": "active"
        }
        requests.post(HEARTBEAT_URL, json=payload, timeout=2)
    except:
        pass  # Fail silently

# ==================== MAIN LOOP ====================
print(f"[INFO] Application Activity Tracker started for {USERNAME}@{COMPUTER_NAME}")
print("[INFO] Press Ctrl+C to stop.\n")

last_app, last_title = None, None
heartbeat_counter = 0

try:
    while True:
        process_name, window_title = get_active_window()
        if process_name and window_title:
            if process_name != last_app or window_title != last_title:
                timestamp = datetime.now().strftime("%H:%M:%S")
                print(f"[{timestamp}] [{USERNAME}] Active App: {process_name} | Window: {window_title}")
                send_log(process_name, window_title)
                last_app, last_title = process_name, window_title
        
        # Send heartbeat every 10 seconds
        heartbeat_counter += 1
        if heartbeat_counter >= 10:
            send_heartbeat()
            heartbeat_counter = 0
        
        time.sleep(POLL_INTERVAL)
except KeyboardInterrupt:
    print(f"\n[INFO] Activity Tracker stopped by user {USERNAME}")
except Exception as e:
    print(f"[ERROR] Unexpected error: {e}")