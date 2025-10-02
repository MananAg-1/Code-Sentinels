# Classroom Control and Monitoring System

## Theme
**Safety and Digital Security Innovations**

## Problem Statement
A secure and cost-effective **Classroom Control and Monitoring System** that enables schools to manage and monitor student computers during classes and exams — without relying on cloud services.

## Team
- **Team Name:** Code Sentinels  
- **School:** Bal Bharati Public School, GRH Marg  
- **Hackathon:** Bal Bharati Hackathon 2.0  

---

## Our Idea
The system provides schools with **full control** over student computers via the school LAN.  

- Teachers can activate **Exam Mode** to lock screens to only allowed apps.  
- A **student agent** runs in the background to detect suspicious activity.  
- **AI-based CCTV monitoring** analyzes classroom feeds to identify cheating attempts.  

All sensitive data (exam files, logs, reports) is secured with **AES-256 encryption**.  

---

## Key Features
- **In-House Deployment** – No dependency on the internet/cloud.  
- **Exam Mode** – Restricts PCs to allowed applications.  
- **Black Box Logs** – Tracks app switching, disconnections, or unauthorized activity.  
- **Secure File Storage** – Encrypted SQLite database.  
- **AI CCTV Monitoring** – Detects suspicious movements/cheating.  
- **Encrypted Communication** – Secure data exchange between agents and dashboard.  
- **Teacher Dashboard** – Real-time monitoring and alerts.  
- **Cost-Effective** – Zero subscription/cloud fees after setup.  

---

## Technology Stack

### 1. Student Agent (Windows PC)
- **Language:** Python  
- **Libraries:** `pywin32`, `psutil`, `ctypes`, `websockets`, `PyInstaller`, `cryptography`, `OpenCV`, `MediaPipe`  

### 2. Backend Server
- **Language:** JavaScript (Node.js)  
- **Frameworks/Tools:** `Express.js`, `Socket.IO`, `SQLite`, AES-256 encryption  

### 3. Teacher Dashboard (Web App)
- **Frontend:** JavaScript, HTML, CSS  
- **Frameworks/Tools:** `React.js`, `Tailwind CSS`, `WebSocket API`, `Fetch API`  

### 4. Communication Protocol
- **Messaging:** WebSockets  
- **Data Format:** JSON  

---

## Approach

1. **Exam Mode Enforcement** – Restricts PCs to specific apps.  
2. **Continuous Monitoring** – Logs suspicious behavior in real-time.  
3. **Secure Storage** – Encrypted logs, exams, and reports.  
4. **Encrypted Communication** – Protects against interception/tampering.  
5. **Real-Time Teacher Control** – Alerts and immediate interventions.  

---

## Dependencies & Challenges
- Requires installation of the **student agent** on all PCs.  
- Needs **stable LAN connectivity** for smooth monitoring.  
- Currently **Windows-only**; cross-platform support pending.  
- Firewalls may block **WebSocket connections**.  
- Dashboard requires a **modern web browser**.  

---

## License
Developed for **Bal Bharati Hackathon 2.0**.  
For educational and non-commercial use only.  
