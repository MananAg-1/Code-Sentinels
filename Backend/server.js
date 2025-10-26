/**
 * UNIFIED CLASSROOM MONITORING SYSTEM
 * 
 * Combines:
 * - Encrypted log reception from student agents
 * - Face recognition with class/section management
 * - Attendance tracking with filtering
 * - Encrypted file upload/download (AES-256-GCM)
 * - Activity logging and monitoring
 * - Exam mode control
 * - Real-time WebSocket updates
 * - CSV export capabilities
 */

require('dotenv').config();
const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cors = require('cors');
const fernet = require('fernet');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// ============================================
// CONFIGURATION
// ============================================
const PORT = process.env.PORT || 8080;
const MASTER_PASSWORD = process.env.MASTER_PASSWORD || 'password123';
const SALT = process.env.SALT || 'bal_bharati_salt';
const DB_PATH = process.env.DB_PATH || './classroom_monitoring.db';
const LOGS_DIR = path.join(__dirname, 'logs');

// AES Configuration for file encryption
const AES_KEY_BASE64 = process.env.AES_KEY_BASE64;
let AES_KEY = null;
if (AES_KEY_BASE64) {
    AES_KEY = Buffer.from(AES_KEY_BASE64, 'base64');
    if (AES_KEY.length !== 32) {
        console.error('⚠️  AES_KEY must be 32 bytes (base64 encoded)');
        AES_KEY = null;
    }
} else {
    console.log('ℹ️  AES_KEY_BASE64 not set - file encryption disabled');
}

// Ensure logs directory exists
if (!fs.existsSync(LOGS_DIR)) {
    fs.mkdirSync(LOGS_DIR, { recursive: true });
}

// ============================================
// INITIALIZE EXPRESS AND SOCKET.IO
// ============================================
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ limit: '50mb', extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// ============================================
// INITIALIZE SQLITE DATABASE
// ============================================
const db = new sqlite3.Database(DB_PATH, (err) => {
    if (err) {
        console.error('❌ Database connection error:', err);
    } else {
        console.log('✅ Connected to SQLite database');
        initializeDatabase();
    }
});

/**
 * Create all database tables
 */
function initializeDatabase() {
    db.serialize(() => {
        // Classroom Monitoring Logs
        db.run(`
            CREATE TABLE IF NOT EXISTS logs (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_identifier TEXT NOT NULL,
                computer_name TEXT NOT NULL,
                username TEXT NOT NULL,
                mac_address TEXT,
                session_id TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                event_type TEXT NOT NULL,
                encrypted_data TEXT NOT NULL,
                severity TEXT NOT NULL,
                device_type TEXT,
                class_section TEXT,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Active Devices Tracking
        db.run(`
            CREATE TABLE IF NOT EXISTS active_devices (
                device_identifier TEXT PRIMARY KEY,
                computer_name TEXT NOT NULL,
                username TEXT NOT NULL,
                device_type TEXT,
                class_section TEXT,
                last_seen DATETIME NOT NULL,
                status TEXT DEFAULT 'ACTIVE'
            )
        `);

        // Alerts/Warnings
        db.run(`
            CREATE TABLE IF NOT EXISTS alerts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                device_identifier TEXT NOT NULL,
                computer_name TEXT NOT NULL,
                alert_type TEXT NOT NULL,
                message TEXT NOT NULL,
                severity TEXT NOT NULL,
                timestamp DATETIME NOT NULL,
                acknowledged INTEGER DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // People Registry (Students/Staff)
        db.run(`
            CREATE TABLE IF NOT EXISTS people (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                name TEXT UNIQUE NOT NULL,
                class TEXT,
                section TEXT,
                roll_number TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Face Images for Recognition
        db.run(`
            CREATE TABLE IF NOT EXISTS face_images (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_id INTEGER,
                image_data BLOB NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE CASCADE
            )
        `);

        // Attendance Records
        db.run(`
            CREATE TABLE IF NOT EXISTS attendance (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                person_name TEXT NOT NULL,
                class TEXT,
                section TEXT,
                roll_number TEXT,
                date TEXT NOT NULL,
                time TEXT NOT NULL,
                timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
                camera_location TEXT DEFAULT 'Main Entrance',
                UNIQUE(person_name, date)
            )
        `);

        // Encrypted Files Storage
        db.run(`
            CREATE TABLE IF NOT EXISTS files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                filename TEXT NOT NULL,
                mimetype TEXT,
                data BLOB NOT NULL,
                iv TEXT NOT NULL,
                auth_tag TEXT NOT NULL,
                uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        console.log('✅ All database tables initialized');
    });
}

// ============================================
// ENCRYPTION UTILITIES
// ============================================

/**
 * Derive Fernet encryption key from master password
 */
function deriveEncryptionKey() {
    const iterations = 100000;
    const keyLength = 32;
    
    const key = crypto.pbkdf2Sync(
        MASTER_PASSWORD,
        SALT,
        iterations,
        keyLength,
        'sha256'
    );
    
    return new fernet.Secret(key.toString('base64url') + '=');
}

/**
 * Decrypt log data using Fernet
 */
function decryptLog(encryptedData) {
    try {
        const secret = deriveEncryptionKey();
        const token = new fernet.Token({
            secret: secret,
            token: encryptedData,
            ttl: 0
        });
        
        const decrypted = token.decode();
        return JSON.parse(decrypted);
    } catch (error) {
        console.error('❌ Decryption error:', error.message);
        return null;
    }
}

// ============================================
// LOGGING FUNCTIONS
// ============================================

function storeEncryptedLog(message) {
    db.run(`
        INSERT INTO logs (
            device_identifier, computer_name, username, mac_address,
            session_id, timestamp, event_type, encrypted_data,
            severity, device_type, class_section
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        message.device_identifier,
        message.computer_name,
        message.username,
        null,
        'unknown',
        new Date().toISOString(),
        'ENCRYPTED_LOG',
        message.data,
        'INFO',
        null,
        null
    ]);
}

function storeLog(logData) {
    const {
        device_identifier, computer_name, username, mac_address,
        session_id, timestamp, event_type, details, severity,
        device_type, class_section
    } = logData;

    const encrypted_data = JSON.stringify(details);

    db.run(`
        INSERT INTO logs (
            device_identifier, computer_name, username, mac_address,
            session_id, timestamp, event_type, encrypted_data,
            severity, device_type, class_section
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `, [
        device_identifier, computer_name, username, mac_address,
        session_id, timestamp, event_type, encrypted_data,
        severity, device_type, class_section
    ]);

    updateActiveDevice(device_identifier, computer_name, username, device_type, class_section);

    if (severity === 'WARNING' || severity === 'CRITICAL') {
        createAlert(device_identifier, computer_name, event_type, details, severity, timestamp);
    }
}

function updateActiveDevice(device_identifier, computer_name, username, device_type, class_section) {
    db.run(`
        INSERT OR REPLACE INTO active_devices (
            device_identifier, computer_name, username, device_type, class_section, last_seen, status
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), 'ACTIVE')
    `, [device_identifier, computer_name, username, device_type, class_section]);
}

function createAlert(device_identifier, computer_name, alert_type, details, severity, timestamp) {
    let message = '';
    
    switch(alert_type) {
        case 'WINDOW_SWITCH':
            message = `Switched from ${details.from} to ${details.to}`;
            break;
        case 'UNAUTHORIZED_APP':
            const apps = details.processes || [];
            const uniqueApps = [...new Set(apps)];
            message = `Unauthorized: ${uniqueApps.join(', ')}`;
            break;
        case 'NETWORK_STATUS':
            message = details.status === 'DISCONNECTED' ? 'Network disconnected' : 'Network connected';
            break;
        case 'HIGH_RESOURCE_USAGE':
            message = `High usage detected`;
            break;
        default:
            message = alert_type;
    }

    db.run(`
        INSERT INTO alerts (device_identifier, computer_name, alert_type, message, severity, timestamp)
        VALUES (?, ?, ?, ?, ?, ?)
    `, [device_identifier, computer_name, alert_type, message, severity, timestamp], (err) => {
        if (!err) {
            io.emit('new_alert', {
                device_identifier, computer_name, alert_type,
                message, severity, timestamp
            });
        }
    });
}

// ============================================
// WEBSOCKET CONNECTION HANDLER
// ============================================

let activityLogs = [];
let exam_active = false;

io.on('connection', (socket) => {
    console.log('✅ New connection:', socket.id);
    
    socket.deviceInfo = null;

    // Send initial state to dashboard
    socket.emit('exam_mode_changed', { exam_active });
    socket.emit('initial_activity_logs', activityLogs);

    // Handle encrypted log messages from student agents
    socket.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'LOG') {
                if (!socket.deviceInfo && message.computer_name) {
                    socket.deviceInfo = {
                        computer_name: message.computer_name,
                        username: message.username,
                        device_identifier: message.device_identifier
                    };
                }
                
                const decryptedLog = decryptLog(message.data);
                
                if (decryptedLog) {
                    storeLog(decryptedLog);
                    io.emit('new_log', {
                        device_identifier: message.device_identifier,
                        computer_name: message.computer_name,
                        username: message.username,
                        event_type: decryptedLog.event_type,
                        severity: decryptedLog.severity,
                        timestamp: decryptedLog.timestamp
                    });
                } else {
                    storeEncryptedLog(message);
                }
            }
        } catch (error) {
            console.error('❌ Error processing message:', error);
        }
    });

    socket.on('disconnect', () => {
        if (socket.deviceInfo) {
            console.log(`❌ Device disconnected: ${socket.deviceInfo.computer_name}`);
        }
    });
});

// ============================================
// CLASSROOM MONITORING API ENDPOINTS
// ============================================

app.get('/api/devices', (req, res) => {
    db.all(`
        SELECT * FROM active_devices 
        WHERE last_seen > datetime('now', '-5 minutes')
        ORDER BY computer_name
    `, [], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ devices: rows });
        }
    });
});

app.get('/api/logs/:device_identifier', (req, res) => {
    const { device_identifier } = req.params;
    const { limit = 100 } = req.query;

    db.all(`
        SELECT * FROM logs 
        WHERE device_identifier = ?
        ORDER BY timestamp DESC
        LIMIT ?
    `, [device_identifier, parseInt(limit)], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ logs: rows });
        }
    });
});

app.get('/api/alerts', (req, res) => {
    const { acknowledged = 0 } = req.query;

    db.all(`
        SELECT * FROM alerts 
        WHERE acknowledged = ?
        ORDER BY timestamp DESC
        LIMIT 100
    `, [parseInt(acknowledged)], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ alerts: rows });
        }
    });
});

app.post('/api/alerts/:id/acknowledge', (req, res) => {
    const { id } = req.params;

    db.run(`UPDATE alerts SET acknowledged = 1 WHERE id = ?`, [id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ success: true });
        }
    });
});

app.get('/api/stats', (req, res) => {
    const stats = {};

    db.get(`SELECT COUNT(*) as total FROM active_devices WHERE last_seen > datetime('now', '-5 minutes')`, [], (err, row) => {
        stats.active_devices = row ? row.total : 0;

        db.get(`SELECT COUNT(*) as total FROM alerts WHERE acknowledged = 0`, [], (err, row) => {
            stats.unacknowledged_alerts = row ? row.total : 0;

            db.get(`SELECT COUNT(*) as total FROM logs WHERE timestamp > datetime('now', '-1 hour')`, [], (err, row) => {
                stats.logs_last_hour = row ? row.total : 0;

                res.json(stats);
            });
        });
    });
});

// ============================================
// ACTIVITY LOGGING ENDPOINTS
// ============================================

app.post('/log', (req, res) => {
    try {
        const log = req.body;
        if (!log || !log.event) return res.status(400).json({ error: 'Invalid log format' });
        
        const ts = new Date(log.timestamp || Date.now()).toISOString();
        const line = `${ts} | ${log.event} | ${JSON.stringify(log.details)}\n`;
        
        fs.appendFile(path.join(LOGS_DIR, 'activity_logs.txt'), line, (err) => {
            if (err) console.error('Failed to save log', err);
        });
        
        io.emit('new_log', { timestamp: ts, event: log.event, details: log.details });
        res.json({ status: 'ok' });
    } catch (err) {
        console.error('Log error', err);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.post('/api/activity-log', (req, res) => {
    try {
        const log = req.body;
        if (!log || !log.timestamp || !log.application || !log.window) {
            return res.status(400).json({ error: 'Invalid log format' });
        }
        
        activityLogs.push(log);
        if (activityLogs.length > 500) activityLogs.shift();
        
        io.emit('new_activity', log);
        res.json({ status: 'ok' });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/api/activity-log', (req, res) => res.json(activityLogs));

// ============================================
// EXAM MODE CONTROL
// ============================================

app.post('/api/exam-mode', (req, res) => {
    try {
        const { exam_active: newMode } = req.body;
        if (typeof newMode !== "boolean") {
            return res.status(400).json({ error: "Invalid exam_active value" });
        }
        
        exam_active = newMode;
        io.emit('exam_mode_changed', { exam_active });
        console.log(`📝 Exam mode set to: ${exam_active}`);
        res.json({ success: true });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Internal error' });
    }
});

app.get('/api/exam-status', (req, res) => res.json({ exam_active }));

// ============================================
// FACE RECOGNITION API ENDPOINTS
// ============================================

// Register person with class/section/roll number
app.post('/api/face/register_person', (req, res) => {
    const { name, class: className, section, roll_number } = req.body;
    
    if (!name) {
        return res.status(400).json({ error: 'Name is required' });
    }
    
    db.get('SELECT id FROM people WHERE name = ?', [name], (err, row) => {
        if (err) {
            return res.status(500).json({ error: 'Database error' });
        }
        
        if (row) {
            db.run(
                'UPDATE people SET class = ?, section = ?, roll_number = ? WHERE id = ?',
                [className, section, roll_number, row.id],
                (updateErr) => {
                    if (updateErr) {
                        return res.status(500).json({ error: 'Failed to update person' });
                    }
                    console.log(`👤 Updated: ${name} (${className}-${section}, Roll: ${roll_number})`);
                    return res.json({ person_id: row.id, success: true, message: 'Person updated' });
                }
            );
        } else {
            db.run(
                'INSERT INTO people (name, class, section, roll_number) VALUES (?, ?, ?, ?)',
                [name, className, section, roll_number],
                function(insertErr) {
                    if (insertErr) {
                        return res.status(500).json({ error: 'Failed to register person' });
                    }
                    console.log(`👤 Registered: ${name} (${className}-${section}, Roll: ${roll_number})`);
                    return res.status(201).json({ person_id: this.lastID, success: true });
                }
            );
        }
    });
});

app.post('/api/face/add_image', (req, res) => {
    const { person_id, image_data } = req.body;
    
    if (!person_id || !image_data) {
        return res.status(400).json({ error: 'person_id and image_data required' });
    }
    
    const imageBuffer = Buffer.from(image_data, 'base64');
    
    db.run(
        'INSERT INTO face_images (person_id, image_data) VALUES (?, ?)',
        [person_id, imageBuffer],
        function(err) {
            if (err) {
                return res.status(500).json({ error: 'Failed to add image' });
            }
            return res.status(201).json({ success: true, image_id: this.lastID });
        }
    );
});

app.get('/api/face/get_people_with_images', (req, res) => {
    db.all('SELECT id, name, class, section, roll_number FROM people ORDER BY class, section, name', [], (err, people) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve people' });
        }
        
        if (people.length === 0) {
            return res.json({ people: [], count: 0 });
        }
        
        let completed = 0;
        const peopleWithImages = [];
        
        people.forEach(person => {
            db.all(
                'SELECT image_data FROM face_images WHERE person_id = ?',
                [person.id],
                (imgErr, images) => {
                    if (!imgErr && images) {
                        const base64Images = images.map(img => img.image_data.toString('base64'));
                        
                        peopleWithImages.push({
                            id: person.id,
                            name: person.name,
                            class: person.class,
                            section: person.section,
                            roll_number: person.roll_number,
                            images: base64Images,
                            image_count: base64Images.length
                        });
                    }
                    
                    completed++;
                    
                    if (completed === people.length) {
                        res.json({ 
                            people: peopleWithImages,
                            count: peopleWithImages.length 
                        });
                    }
                }
            );
        });
    });
});

app.post('/api/face/upload_dataset', (req, res) => {
    const { people_data } = req.body;
    
    if (!people_data || !Array.isArray(people_data)) {
        return res.status(400).json({ error: 'people_data array is required' });
    }
    
    let totalPeople = 0;
    let totalImages = 0;
    
    const processNextPerson = (index) => {
        if (index >= people_data.length) {
            console.log(`📊 Dataset upload complete: ${totalPeople} people, ${totalImages} images`);
            return res.json({ 
                success: true, 
                people_count: totalPeople,
                image_count: totalImages
            });
        }
        
        const person = people_data[index];
        const { name, class: className, section, roll_number, images } = person;
        
        if (!name || !images || !Array.isArray(images)) {
            return processNextPerson(index + 1);
        }
        
        db.get('SELECT id FROM people WHERE name = ?', [name], (err, row) => {
            if (err) {
                return processNextPerson(index + 1);
            }
            
            const insertImages = (personId) => {
                db.run('DELETE FROM face_images WHERE person_id = ?', [personId], () => {
                    let imagesProcessed = 0;
                    
                    images.forEach(base64Image => {
                        const imageBuffer = Buffer.from(base64Image, 'base64');
                        db.run(
                            'INSERT INTO face_images (person_id, image_data) VALUES (?, ?)',
                            [personId, imageBuffer],
                            (insertErr) => {
                                if (!insertErr) totalImages++;
                                imagesProcessed++;
                                
                                if (imagesProcessed === images.length) {
                                    totalPeople++;
                                    processNextPerson(index + 1);
                                }
                            }
                        );
                    });
                });
            };
            
            if (row) {
                db.run(
                    'UPDATE people SET class = ?, section = ?, roll_number = ? WHERE id = ?',
                    [className, section, roll_number, row.id],
                    () => {
                        insertImages(row.id);
                    }
                );
            } else {
                db.run(
                    'INSERT INTO people (name, class, section, roll_number) VALUES (?, ?, ?, ?)',
                    [name, className, section, roll_number],
                    function(insertErr) {
                        if (!insertErr) {
                            insertImages(this.lastID);
                        } else {
                            processNextPerson(index + 1);
                        }
                    }
                );
            }
        });
    };
    
    processNextPerson(0);
});

app.get('/api/face/get_people', (req, res) => {
    db.all(`
        SELECT p.id, p.name, p.class, p.section, p.roll_number, p.created_at, COUNT(i.id) as image_count
        FROM people p
        LEFT JOIN face_images i ON p.id = i.person_id
        GROUP BY p.id
        ORDER BY p.class, p.section, p.name
    `, [], (err, rows) => {
        if (err) {
            return res.status(500).json({ error: 'Failed to retrieve people' });
        }
        
        return res.json({ 
            people: rows,
            count: rows.length 
        });
    });
});

// ============================================
// ATTENDANCE API ENDPOINTS
// ============================================

app.post('/api/attendance/mark', (req, res) => {
    const { person_name, date, time, camera_location } = req.body;

    if (!person_name || !date || !time) {
        return res.status(400).json({ error: 'Missing required fields' });
    }

    db.get(
        'SELECT class, section, roll_number FROM people WHERE name = ?',
        [person_name],
        (err, person) => {
            const className = person ? person.class : null;
            const section = person ? person.section : null;
            const rollNumber = person ? person.roll_number : null;

            const query = `
                INSERT INTO attendance (person_name, class, section, roll_number, date, time, camera_location)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(person_name, date) DO UPDATE SET
                    time = excluded.time,
                    timestamp = CURRENT_TIMESTAMP
            `;

            db.run(query, [person_name, className, section, rollNumber, date, time, camera_location || 'Main Entrance'], function(err) {
                if (err) {
                    return res.status(500).json({ error: err.message });
                }

                console.log(`✅ Attendance: ${person_name} (${className}-${section}) at ${time}`);
                
                io.emit('new_attendance', {
                    person_name,
                    class: className,
                    section,
                    roll_number: rollNumber,
                    date,
                    time,
                    camera_location: camera_location || 'Main Entrance'
                });

                res.json({ 
                    success: true, 
                    message: `Attendance marked for ${person_name}`,
                    id: this.lastID 
                });
            });
        }
    );
});

app.get('/api/attendance/today', (req, res) => {
    const today = new Date().toISOString().split('T')[0];
    const { class: className, section } = req.query;

    let query = 'SELECT * FROM attendance WHERE date = ?';
    let params = [today];

    if (className) {
        query += ' AND class = ?';
        params.push(className);
    }
    if (section) {
        query += ' AND section = ?';
        params.push(section);
    }

    query += ' ORDER BY class, section, roll_number, time ASC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ 
            date: today, 
            count: rows.length, 
            records: rows 
        });
    });
});

app.get('/api/attendance/date/:date', (req, res) => {
    const { date } = req.params;
    const { class: className, section } = req.query;

    let query = 'SELECT * FROM attendance WHERE date = ?';
    let params = [date];

    if (className) {
        query += ' AND class = ?';
        params.push(className);
    }
    if (section) {
        query += ' AND section = ?';
        params.push(section);
    }

    query += ' ORDER BY class, section, roll_number, time ASC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ date, count: rows.length, records: rows });
    });
});

app.get('/api/attendance/range', (req, res) => {
    const { start_date, end_date, class: className, section } = req.query;

    if (!start_date || !end_date) {
        return res.status(400).json({ error: 'start_date and end_date required' });
    }

    let query = 'SELECT * FROM attendance WHERE date BETWEEN ? AND ?';
    let params = [start_date, end_date];

    if (className) {
        query += ' AND class = ?';
        params.push(className);
    }
    if (section) {
        query += ' AND section = ?';
        params.push(section);
    }

    query += ' ORDER BY date DESC, class, section, roll_number, time ASC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ 
            start_date, 
            end_date, 
            count: rows.length, 
            records: rows 
        });
    });
});

app.get('/api/attendance/person/:name', (req, res) => {
    const { name } = req.params;
    const { start_date, end_date } = req.query;

    let query = 'SELECT * FROM attendance WHERE person_name = ?';
    let params = [name];

    if (start_date && end_date) {
        query += ' AND date BETWEEN ? AND ?';
        params.push(start_date, end_date);
    }

    query += ' ORDER BY date DESC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ 
            person_name: name, 
            count: rows.length, 
            records: rows 
        });
    });
});

app.get('/api/attendance/summary', (req, res) => {
    const { class: className, section } = req.query;

    let whereClause = '';
    let params = [];

    if (className) {
        whereClause = ' AND class = ?';
        params.push(className);
    }
    if (section) {
        whereClause += ' AND section = ?';
        params.push(section);
    }

    const queries = {
        today: `SELECT COUNT(*) as count FROM attendance WHERE date = date('now')${whereClause}`,
        this_week: `SELECT COUNT(*) as count FROM attendance WHERE date >= date('now', '-7 days')${whereClause}`,
        this_month: `SELECT COUNT(*) as count FROM attendance WHERE date >= date('now', 'start of month')${whereClause}`,
        total_people: `SELECT COUNT(DISTINCT person_name) as count FROM attendance WHERE 1=1${whereClause}`,
        recent: `SELECT * FROM attendance WHERE 1=1${whereClause} ORDER BY timestamp DESC LIMIT 10`
    };

    const summary = {};

    db.get(queries.today, params, (err, row) => {
        summary.today = row ? row.count : 0;

        db.get(queries.this_week, params, (err, row) => {
            summary.this_week = row ? row.count : 0;

            db.get(queries.this_month, params, (err, row) => {
                summary.this_month = row ? row.count : 0;

                db.get(queries.total_people, params, (err, row) => {
                    summary.total_people = row ? row.count : 0;

                    db.all(queries.recent, params, (err, rows) => {
                        summary.recent_attendance = rows || [];
                        res.json(summary);
                    });
                });
            });
        });
    });
});

app.get('/api/attendance/export/csv', (req, res) => {
    const { start_date, end_date, class: className, section } = req.query;

    let query = 'SELECT person_name, class, section, roll_number, date, time, camera_location FROM attendance WHERE 1=1';
    let params = [];

    if (start_date && end_date) {
        query += ' AND date BETWEEN ? AND ?';
        params.push(start_date, end_date);
    }
    if (className) {
        query += ' AND class = ?';
        params.push(className);
    }
    if (section) {
        query += ' AND section = ?';
        params.push(section);
    }

    query += ' ORDER BY date DESC, class, section, roll_number, time ASC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        let csv = 'Name,Class,Section,Roll Number,Date,Time,Location\n';
        rows.forEach(row => {
            csv += `${row.person_name},${row.class || 'N/A'},${row.section || 'N/A'},${row.roll_number || 'N/A'},${row.date},${row.time},${row.camera_location}\n`;
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=attendance_export.csv');
        res.send(csv);
    });
});

app.delete('/api/attendance/:id', (req, res) => {
    const { id } = req.params;

    db.run('DELETE FROM attendance WHERE id = ?', [id], function(err) {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ success: true, message: 'Attendance record deleted' });
    });
});

// ============================================
// CLASS & SECTION MANAGEMENT ENDPOINTS
// ============================================

app.get('/api/classes/list', (req, res) => {
    db.all(
        'SELECT DISTINCT class FROM people WHERE class IS NOT NULL ORDER BY class',
        [],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const classes = rows.map(row => row.class);
            res.json({ classes });
        }
    );
});

app.get('/api/sections/list/:class', (req, res) => {
    const { class: className } = req.params;
    
    db.all(
        'SELECT DISTINCT section FROM people WHERE class = ? AND section IS NOT NULL ORDER BY section',
        [className],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            const sections = rows.map(row => row.section);
            res.json({ class: className, sections });
        }
    );
});

app.get('/api/people/list', (req, res) => {
    const { class: className, section } = req.query;

    let query = 'SELECT id, name, class, section, roll_number, created_at FROM people WHERE 1=1';
    let params = [];

    if (className) {
        query += ' AND class = ?';
        params.push(className);
    }
    if (section) {
        query += ' AND section = ?';
        params.push(section);
    }

    query += ' ORDER BY class, section, roll_number, name ASC';

    db.all(query, params, (err, rows) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }
        res.json({ count: rows.length, people: rows });
    });
});

// ============================================
// FILE UPLOAD/DOWNLOAD ENDPOINTS (AES-256-GCM)
// ============================================

const upload = multer({ 
    storage: multer.memoryStorage(), 
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
});

app.get('/files', (req, res) => {
    db.all('SELECT id, filename, mimetype, uploaded_at FROM files ORDER BY uploaded_at DESC', (err, rows) => {
        if (err) return res.status(500).json({ error: 'DB error' });
        res.json(rows);
    });
});

app.post('/upload', upload.single('file'), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    
    if (!AES_KEY) {
        return res.status(500).json({ error: 'File encryption not configured' });
    }
    
    try {
        const iv = crypto.randomBytes(12);
        const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
        const encrypted = Buffer.concat([cipher.update(req.file.buffer), cipher.final()]);
        const authTag = cipher.getAuthTag();
        
        const stmt = db.prepare('INSERT INTO files (filename, mimetype, data, iv, auth_tag) VALUES (?, ?, ?, ?, ?)');
        stmt.run(
            req.file.originalname, 
            req.file.mimetype || 'application/octet-stream', 
            encrypted, 
            iv.toString('base64'), 
            authTag.toString('base64'), 
            function(err) {
                if (err) return res.status(500).json({ error: 'DB insert error' });
                console.log(`📁 File uploaded: ${req.file.originalname}`);
                res.json({ success: true, id: this.lastID });
            }
        );
        stmt.finalize();
    } catch (e) {
        console.error(e);
        res.status(500).json({ error: 'Encryption error' });
    }
});

app.get('/download/:id', (req, res) => {
    const id = Number(req.params.id);
    
    if (!AES_KEY) {
        return res.status(500).send('File encryption not configured');
    }
    
    db.get('SELECT filename, mimetype, data, iv, auth_tag FROM files WHERE id = ?', [id], (err, row) => {
        if (err) return res.status(500).send('DB error');
        if (!row) return res.status(404).send('Not found');
        
        try {
            const iv = Buffer.from(row.iv, 'base64');
            const authTag = Buffer.from(row.auth_tag, 'base64');
            const decipher = crypto.createDecipheriv('aes-256-gcm', AES_KEY, iv);
            decipher.setAuthTag(authTag);
            const decrypted = Buffer.concat([decipher.update(row.data), decipher.final()]);
            
            res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
            res.setHeader('Content-Type', row.mimetype || 'application/octet-stream');
            res.send(decrypted);
        } catch (e) {
            console.error('Decryption error', e);
            res.status(500).send('Decryption failed');
        }
    });
});

// ============================================
// HEALTH CHECK
// ============================================

app.get('/health', (req, res) => {
    res.json({ 
        status: 'ok', 
        timestamp: new Date().toISOString(),
        exam_mode: exam_active,
        file_encryption: AES_KEY ? 'enabled' : 'disabled'
    });
});

// ============================================
// START SERVER
// ============================================

server.listen(PORT, '0.0.0.0', () => {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  UNIFIED CLASSROOM MONITORING & ATTENDANCE SYSTEM             ║
║  Complete Integration with All Features                       ║
╠═══════════════════════════════════════════════════════════════╣
║  Server: http://0.0.0.0:${PORT}                                   ║
║  WebSocket: ws://0.0.0.0:${PORT}                                  ║
╠═══════════════════════════════════════════════════════════════╣
║  📡 CLASSROOM MONITORING APIs:                                ║
║  - GET  /api/devices                                          ║
║  - GET  /api/logs/:device_identifier                          ║
║  - GET  /api/alerts                                           ║
║  - POST /api/alerts/:id/acknowledge                           ║
║  - GET  /api/stats                                            ║
║                                                               ║
║  👤 FACE RECOGNITION APIs:                                    ║
║  - POST /api/face/register_person                             ║
║  - POST /api/face/add_image                                   ║
║  - GET  /api/face/get_people_with_images                      ║
║  - POST /api/face/upload_dataset                              ║
║  - GET  /api/face/get_people                                  ║
║                                                               ║
║  ✅ ATTENDANCE APIs:                                          ║
║  - POST /api/attendance/mark                                  ║
║  - GET  /api/attendance/today?class=X&section=Y               ║
║  - GET  /api/attendance/date/:date?class=X&section=Y          ║
║  - GET  /api/attendance/range?start_date&end_date&class...    ║
║  - GET  /api/attendance/person/:name                          ║
║  - GET  /api/attendance/summary?class=X&section=Y             ║
║  - GET  /api/attendance/export/csv?class=X&section=Y          ║
║  - DELETE /api/attendance/:id                                 ║
║                                                               ║
║  🏫 CLASS/SECTION MANAGEMENT:                                 ║
║  - GET  /api/classes/list                                     ║
║  - GET  /api/sections/list/:class                             ║
║  - GET  /api/people/list?class=X&section=Y                    ║
║                                                               ║
║  📁 FILE MANAGEMENT (AES-256-GCM):                            ║
║  - GET  /files                                                ║
║  - POST /upload                                               ║
║  - GET  /download/:id                                         ║
║                                                               ║
║  📝 ACTIVITY LOGGING:                                         ║
║  - POST /log                                                  ║
║  - POST /api/activity-log                                     ║
║  - GET  /api/activity-log                                     ║
║                                                               ║
║  🎓 EXAM MODE:                                                ║
║  - POST /api/exam-mode                                        ║
║  - GET  /api/exam-status                                      ║
║                                                               ║
║  Dashboard: http://localhost:${PORT}                              ║
╚═══════════════════════════════════════════════════════════════╝
    `);
    console.log('✅ Classroom monitoring active');
    console.log('✅ Face recognition system active');
    console.log('✅ Attendance tracking enabled');
    console.log('✅ Activity logging enabled');
    console.log(`${AES_KEY ? '✅' : '⚠️ '} File encryption ${AES_KEY ? 'enabled' : 'disabled (set AES_KEY_BASE64 in .env)'}`);
    console.log(`📝 Exam mode: ${exam_active ? 'ACTIVE' : 'INACTIVE'}`);
});

// ============================================
// GRACEFUL SHUTDOWN
// ============================================

process.on('SIGINT', () => {
    console.log('\n⚠️  Shutting down server...');
    db.close((err) => {
        if (err) {
            console.error('❌ Error closing database:', err);
        } else {
            console.log('✅ Database closed');
        }
        process.exit(0);
    });
});