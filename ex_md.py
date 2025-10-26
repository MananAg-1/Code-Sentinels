import subprocess
import time
import threading
import os
import requests

SERVER_URL = "http://localhost:3000/api/exam-status"

ALLOWED_APPS = {
    'cmd.exe', 'notepad.exe', 'calc.exe', 'code.exe', 'explorer.exe',
    'svchost.exe', 'winlogon.exe', 'csrss.exe', 'services.exe',
    'lsass.exe', 'smss.exe', 'taskhostw.exe', 'conhost.exe',
    'dwm.exe', 'sihost.exe', 'fontdrvhost.exe', 'wuauclt.exe',
    'spoolsv.exe', 'searchindexer.exe', 'python.exe', 'pythonw.exe',
    'chrome.exe', 'node.exe', 'tasklist.exe', 'wininit.exe',
    'runtimebroker.exe', 'ctfmon.exe'
}

class LockdownMode:
    def __init__(self):
        self.is_active = False
        self._lock = threading.Lock()

    def activate(self):
        with self._lock:
            if not self.is_active:
                self.is_active = True
                print("[LOCKDOWN] Lockdown mode ACTIVATED!")

    def deactivate(self):
        with self._lock:
            if self.is_active:
                self.is_active = False
                print("[LOCKDOWN] Lockdown mode DEACTIVATED!")

    def _get_running_apps(self):
        try:
            tasklist = subprocess.check_output(
                'tasklist', shell=True, stderr=subprocess.DEVNULL
            ).decode(errors='ignore')
            lines = tasklist.splitlines()[3:]
            return [line.split()[0] for line in lines if line.strip()]
        except Exception as e:
            print("[ERROR] Retrieving tasklist:", e)
            return []

    def check_running_apps(self):
        if not self.is_active:
            return  # Do not block anything if exam mode is off

        running = [app.lower() for app in self._get_running_apps()]
        for app in running:
            if app.startswith('python') or app in ALLOWED_APPS:
                continue
            self.block_application(app)

    def block_application(self, app_name):
        print(f"[BLOCK] Terminating {app_name}...")
        try:
            subprocess.Popen(
                ['taskkill', '/F', '/IM', app_name],
                stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL
            )
        except Exception as e:
            print(f"[ERROR] Could not terminate {app_name}: {e}")


def poll_server(lockdown: LockdownMode):
    while True:
        try:
            response = requests.get(SERVER_URL, timeout=5)
            if response.status_code == 200:
                data = response.json()
                if data.get("exam_active", False):
                    lockdown.activate()
                else:
                    lockdown.deactivate()
            else:
                print(f"[WARN] Server returned status {response.status_code}")
        except requests.exceptions.RequestException:
            print("[WARN] Cannot reach teacher dashboard.")

        lockdown.check_running_apps()
        time.sleep(2)


def main():
    lockdown = LockdownMode()
    print("[INFO] Lockdown agent running. Polling teacher dashboard...")
    try:
        poll_server(lockdown)
    except KeyboardInterrupt:
        lockdown.deactivate()
        print("[INFO] Exiting lockdown watcher...")


if __name__ == "__main__":
    if os.name != 'nt':
        print("[ERROR] This script only works on Windows.")
    else:
        main()
