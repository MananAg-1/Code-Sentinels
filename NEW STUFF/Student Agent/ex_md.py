import subprocess
import time
import threading
import os
import requests
import socket
import getpass

SERVER_URL = "http://192.168.137.1:8080/api/exam-status"
HEARTBEAT_URL = "http://192.168.137.1:8080/api/heartbeat"

# Use blocklist instead of allowlist - more flexible
BLOCKED_APPS = {
    # Communication apps
    'discord.exe', 'telegram.exe', 'whatsapp.exe', 'whatsappdesktop.exe', 'slack.exe',
    'zoom.exe', 'teams.exe', 'skype.exe', 'messenger.exe', 'signal.exe',
    'viber.exe', 'wechat.exe', 'line.exe', 'snapchat.exe',
    
    # Web browsers
    'chrome.exe', 'firefox.exe', 'msedge.exe', 'brave.exe', 'opera.exe',
    'operagx.exe', 'vivaldi.exe', 'iexplore.exe', 'safari.exe', 'tor.exe',
    'chromium.exe', 'yandex.exe', 'seamonkey.exe', 'palemoon.exe',
    
    # Gaming platforms & games
    'steam.exe', 'steamwebhelper.exe', 'epicgameslauncher.exe', 'eossdk-win64-shipping.exe',
    'roblox.exe', 'robloxplayerbeta.exe', 'robloxplayerlauncher.exe', 'robloxstudio.exe',
    'minecraft.exe', 'minecraftlauncher.exe', 'javaw.exe',  # Minecraft uses Java
    'fortnite.exe', 'fortnitelauncher.exe', 'fortniteclient-win64-shipping.exe',
    'leagueclient.exe', 'league of legends.exe', 'valorant.exe', 'valorant-win64-shipping.exe',
    'gta5.exe', 'gtavlauncher.exe', 'rocketleague.exe', 'apexlegends.exe',
    'csgo.exe', 'dota2.exe', 'pubg.exe', 'origin.exe', 'ea.exe', 'eadesktop.exe',
    'uplay.exe', 'upc.exe', 'battlenet.exe', 'battle.net.exe',
    'minecraft dungeons.exe', 'amongus.exe', 'fallguys.exe',
    
    # Media & entertainment
    'spotify.exe', 'vlc.exe', 'itunes.exe', 'apple music.exe', 'netflix.exe',
    'hulu.exe', 'disney+.exe', 'primevideo.exe', 'youtube music.exe',
    'youtubemusic.exe', 'tidal.exe', 'deezer.exe', 'soundcloud.exe',
    'obs64.exe', 'obs32.exe', 'streamlabs obs.exe', 'xsplit.broadcaster.exe',
    
    # Code editors (non-educational)
    'notepad++.exe', 'sublime_text.exe', 'atom.exe', 'brackets.exe',
    
    # Microsoft Store & related
    'winstore.app.exe', 'microsoft.windowsstore.exe', 'wwahost.exe',
    'ms-windows-store.exe', 'windowsstore.exe',
    
    # Remote desktop & VPN
    'teamviewer.exe', 'anydesk.exe', 'remotedesktop.exe', 'mstsc.exe',
    'vnc.exe', 'vncviewer.exe', 'logmein.exe', 'ammyy.exe',
    'nordvpn.exe', 'expressvpn.exe', 'cyberghost.exe', 'protonvpn.exe',
    'tunnelbear.exe', 'windscribe.exe', 'surfshark.exe',
    
    # Social media desktop apps
    'instagram.exe', 'facebook.exe', 'twitter.exe', 'x.exe',
    'reddit.exe', 'pinterest.exe', 'tumblr.exe', 'linkedin.exe',
    
    # File sharing & torrents
    'utorrent.exe', 'bittorrent.exe', 'qbittorrent.exe', 'transmission.exe',
    'deluge.exe', 'vuze.exe', 'frostwire.exe',
    
    # Virtual machines (can be used to bypass restrictions)
    'vmware.exe', 'vmware-vmx.exe', 'virtualbox.exe', 'virtualboxvm.exe',
    'vboxheadless.exe', 'vboxmanage.exe', 'qemu.exe', 'qemu-system-x86_64.exe',
    
    # Android emulators
    'bluestacks.exe', 'bluestacksservices.exe', 'noxplayer.exe', 'nox.exe',
    'ldplayer.exe', 'memu.exe', 'gameloop.exe',
    
    # Other common distractions
    'calculatorapp.exe',  # Can remove if calc is needed
    'paint.exe', 'mspaint.exe',  # Can remove if needed for assignments
    'solitaire.exe', 'freecell.exe', 'minesweeper.exe',
    'candy crush.exe', 'minecraft earth.exe',

}

class LockdownMode:
    def __init__(self):
        self.is_active = False
        self._lock = threading.Lock()
        self.computer_name = socket.gethostname()
        self.username = getpass.getuser()

    def activate(self):
        with self._lock:
            if not self.is_active:
                self.is_active = True
                print(f"[LOCKDOWN] Lockdown mode ACTIVATED for {self.username}@{self.computer_name}")

    def deactivate(self):
        with self._lock:
            if self.is_active:
                self.is_active = False
                print(f"[LOCKDOWN] Lockdown mode DEACTIVATED for {self.username}@{self.computer_name}")

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
            return

        running = [app.lower() for app in self._get_running_apps()]
        
        for app in running:
            # Only block apps in the blocklist
            if app in BLOCKED_APPS:
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

    def send_heartbeat(self):
        """Send heartbeat to server with user info"""
        try:
            payload = {
                "computer_name": self.computer_name,
                "username": self.username,
                "status": "active" if self.is_active else "inactive"
            }
            requests.post(HEARTBEAT_URL, json=payload, timeout=2)
        except:
            pass  # Fail silently


def poll_server(lockdown: LockdownMode):
    heartbeat_counter = 0
    
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
        
        # Send heartbeat every 5 polls (10 seconds)
        heartbeat_counter += 1
        if heartbeat_counter >= 5:
            lockdown.send_heartbeat()
            heartbeat_counter = 0
        
        time.sleep(2)


def main():
    lockdown = LockdownMode()
    print(f"[INFO] Lockdown agent running for {lockdown.username}@{lockdown.computer_name}")
    print("[INFO] Polling teacher dashboard...")
    print(f"[INFO] Blocking {len(BLOCKED_APPS)} applications during exam mode")
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