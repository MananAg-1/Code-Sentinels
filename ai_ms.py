import cv2
import mediapipe as mp
import math


mp_pose = mp.solutions.pose
mp_face = mp.solutions.face_mesh
mp_drawing = mp.solutions.drawing_utils

pose = mp_pose.Pose()
face = mp_face.FaceMesh(refine_landmarks=True)

cap = cv2.VideoCapture(0)

def distance(p1, p2):
    return math.sqrt((p1.x - p2.x)**2 + (p1.y - p2.y)**2)

while cap.isOpened():
    ret, frame = cap.read()
    if not ret:
        break

    rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
    pose_results = pose.process(rgb)
    face_results = face.process(rgb)

    h, w, _ = frame.shape

    if pose_results.pose_landmarks:
        landmarks = pose_results.pose_landmarks.landmark

        # Key body points
        left_wrist = landmarks[mp_pose.PoseLandmark.LEFT_WRIST]
        right_wrist = landmarks[mp_pose.PoseLandmark.RIGHT_WRIST]
        left_shoulder = landmarks[mp_pose.PoseLandmark.LEFT_SHOULDER]
        right_shoulder = landmarks[mp_pose.PoseLandmark.RIGHT_SHOULDER]
        left_hip = landmarks[mp_pose.PoseLandmark.LEFT_HIP]
        right_hip = landmarks[mp_pose.PoseLandmark.RIGHT_HIP]
        nose = landmarks[mp_pose.PoseLandmark.NOSE]

        # Hands stretched
        shoulder_width = distance(left_shoulder, right_shoulder)
        left_hand_dist = distance(left_wrist, left_shoulder)
        right_hand_dist = distance(right_wrist, right_shoulder)

        if left_hand_dist > 1.5 * shoulder_width or right_hand_dist > 1.5 * shoulder_width:
            cv2.putText(frame, "Hands Stretched!", (50, 50),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 0, 255), 2)

    # Looking here and there check
    if face_results.multi_face_landmarks:
        face_landmarks = face_results.multi_face_landmarks[0].landmark
        left_eye = face_landmarks[33]  # left eye landmark
        right_eye = face_landmarks[263]  # right eye landmark
        nose_tip = face_landmarks[1]

        eye_line = right_eye.x - left_eye.x
        nose_center = (left_eye.x + right_eye.x) / 2

        if abs(nose_tip.x - nose_center) > 0.05:  # threshold for looking away
            cv2.putText(frame, "Looking Away!", (50, 150),
                        cv2.FONT_HERSHEY_SIMPLEX, 1, (0, 255, 255), 2)

    # Draw pose skeleton
    mp_drawing.draw_landmarks(frame, pose_results.pose_landmarks, mp_pose.POSE_CONNECTIONS)

    cv2.imshow("Student Monitor", frame)
    if cv2.waitKey(1) & 0xFF == 27:
        break

cap.release()
cv2.destroyAllWindows()