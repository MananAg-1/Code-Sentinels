Classroom Control and Monitoring System

*Theme*
Safety and Digital Security Innovations

*Problem Statement*
A secure and cost-effective Classroom Control and Monitoring System that enables schools to manage and monitor student computers during classes and exams without relying on cloud services.

*Team*
Team Name: Code Sentinels
School: Bal Bharati Public School, GRH Marg
Hackathon: Bal Bharati Hackathon 2.0

*Our Idea*
Our system empowers schools with full control over student computers via the school’s LAN network. Teachers can enforce Exam Mode, continuously monitor suspicious activity, and even integrate AI-powered CCTV monitoring to detect cheating behavior.
All sensitive data (exam files, student logs, reports) is encrypted using AES-256 to ensure maximum security.

*Key Features*

In-House Deployment: Runs entirely on the school LAN, independent of internet/cloud.
Exam Mode: Locks student screens to allowed applications only.
Black Box Logs: Continuous monitoring of app switching, network drops, and unauthorized activity.
Secure File Storage: Encrypted SQLite database with AES-256.
AI CCTV Monitoring: Detects unusual movements or coordinated cheating.
Encrypted Communication: Secure messaging between agents, server, and dashboard.
Teacher Dashboard: Real-time monitoring, alerts, and control.
Cost-Effective: Zero subscription/cloud fees after setup.

*Technology Stack*

1. Student Agent (Windows PC)
Language: Python
Libraries: pywin32, psutil, ctypes, websockets, PyInstaller, cryptography, OpenCV, MediaPipe

2. Backend Server
Language: JavaScript (Node.js)
Frameworks/Tools: Express.js, Socket.IO, SQLite, AES-256 encryption

3. Teacher Dashboard (Web App)
Frontend: JavaScript, HTML, CSS
Frameworks/Tools: React.js, Tailwind CSS, WebSocket API, Fetch API

4. Communication Protocol
Real-Time Messaging: WebSockets
Data Format: JSON

*Approach*

Exam Mode Enforcement – Restricts student PCs to allowed apps.
Continuous Monitoring – Logs suspicious activity in background.
Secure Storage – Encrypts logs, exams, and reports.
Encrypted Communication – Prevents interception/tampering.
Real-Time Teacher Control – Instant alerts and interventions.

*Dependencies / Challenges*

Deployment: Agents must be installed on all student PCs.
LAN Stability: Requires reliable LAN for smooth monitoring.
Cross-Platform Support: Currently Windows-only.
Firewall Issues: WebSocket connections may be blocked in some setups.
Dashboard Requirements: Needs modern web browser for teachers.

*License*
This project is developed as part of Bal Bharati Hackathon 2.0.
For educational and non-commercial use only.
