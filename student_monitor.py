import cv2
import mediapipe as mp
import math
import requests
import time
from datetime import datetime

# ==================== CONFIG ====================
SERVER_URL = "http://localhost:3000/log"
CAM_INDEX = 0
PROCESS_EVERY_N_FRAMES = 3       # process every 3rd frame
EVENT_COOLDOWN = 5               # seconds between identical logs

# ==================== INIT MODELS ====================
mp_pose = mp.solutions.pose
mp_face = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils

pose = mp_pose.Pose()
face = mp_face.FaceMesh(refine_landmarks=True)
cap = cv2.VideoCapture(CAM_INDEX)

# ==================== STATE TRACKING ====================
last_logged = {
    "Hands Stretched": 0,
    "Looking Away": 0
}

def distance(p1, p2):
    return math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2)

def send_log(event, details=None):
    now = time.time()
    if now - last_logged.get(event, 0) < EVENT_COOLDOWN:
        return  # skip duplicate logs
    last_logged[event] = now

    try:
        payload = {
            "event": event,
            "details": details or {},
            "timestamp": datetime.now().isoformat()
        }
        requests.post(SERVER_URL, json=payload, timeout=2)
        print(f"[LOG] {event} sent.")
    except Exception as e:
        print(f"[!] Failed to send log: {e}")

# ==================== MAIN LOOP ====================
print("[INFO] Starting student monitoring system...")
frame_count = 0

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break
    frame_count += 1

    # Skip frames to reduce processing load
    if frame_count % PROCESS_EVERY_N_FRAMES != 0:
        continue

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pose_results = pose.process(rgb)
    face_results = face.process(rgb)

    # -------------------- HAND STRETCH DETECTION --------------------
    if pose_results.pose_landmarks:
        landmarks = pose_results.pose_landmarks.landmark
        lw, rw = landmarks[mp_pose.PoseLandmark.LEFT_WRIST], landmarks[mp_pose.PoseLandmark.RIGHT_WRIST]
        ls, rs = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER], landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]

        shoulder_width = distance(ls, rs)
        if (distance(lw, ls) > 1.5 * shoulder_width) or (distance(rw, rs) > 1.5 * shoulder_width):
            cv2.putText(frame, "Hands Stretched!", (50, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)
            send_log("Hands Stretched")

    # -------------------- LOOKING AWAY DETECTION --------------------
    if face_results.multi_face_landmarks:
        face_landmarks = face_results.multi_face_landmarks[0].landmark
        left_eye, right_eye, nose_tip = face_landmarks[33], face_landmarks[263], face_landmarks[1]
        nose_center = (left_eye.x + right_eye.x) / 2

        deviation = abs(nose_tip.x - nose_center)
        if deviation > 0.05:
            cv2.putText(frame, "Looking Away!", (50, 100),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)
            send_log("Looking Away", {"deviation": deviation})

    # -------------------- DRAW SKELETON --------------------
    if pose_results.pose_landmarks:
        mp_drawing.draw_landmarks(frame, pose_results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

    cv2.imshow("Student Monitor", frame)

    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()
print("[INFO] Monitoring stopped.")
