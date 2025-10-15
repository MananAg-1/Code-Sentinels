/**
 * Backend Server - Classroom Monitoring System
 * Receives encrypted logs from student agents, stores in SQLite, serves to teacher dashboard
 */

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const cors = require('cors');
const fernet = require('fernet');

// Configuration
const PORT = 8080;
const MASTER_PASSWORD = 'password123'; // Must match student agent
const SALT = 'bal_bharati_salt';

// Initialize Express and Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
    cors: {
        origin: "*",
        methods: ["GET", "POST"]
    }
});

app.use(cors());
app.use(express.json());

// Initialize SQLite Database
const db = new sqlite3.Database('./classroom_monitoring.db', (err) => {
    if (err) {
        console.error('[-] Database connection error:', err);
    } else {
        console.log('[+] Connected to SQLite database');
        initializeDatabase();
    }
});

/**
 * Create database tables
 */
function initializeDatabase() {
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
    `, (err) => {
        if (err) {
            console.error('[-] Error creating logs table:', err);
        } else {
            console.log('[+] Logs table ready');
        }
    });

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
    `, (err) => {
        if (err) {
            console.error('[-] Error creating active_devices table:', err);
        } else {
            console.log('[+] Active devices table ready');
        }
    });

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
    `, (err) => {
        if (err) {
            console.error('[-] Error creating alerts table:', err);
        } else {
            console.log('[+] Alerts table ready');
        }
    });
}

/**
 * Derive encryption key from master password (matches Python implementation)
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
    
    // Convert to URL-safe base64 (Fernet format)
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
        console.error('[-] Decryption error:', error.message);
        return null;
    }
}

/**
 * Store encrypted log when decryption fails
 */
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
        null, // mac_address unknown
        'unknown', // session_id unknown
        new Date().toISOString(), // current timestamp
        'ENCRYPTED_LOG',
        message.data, // store encrypted data as-is
        'INFO',
        null, // device_type unknown
        null  // class_section unknown
    ], (err) => {
        if (err) {
            console.error('[-] Error storing encrypted log:', err);
        }
    });
}

/**
 * Store log in database
 */
function storeLog(logData) {
    const {
        device_identifier,
        computer_name,
        username,
        mac_address,
        session_id,
        timestamp,
        event_type,
        details,
        severity,
        device_type,
        class_section
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
    ], (err) => {
        if (err) {
            console.error('[-] Error storing log:', err);
        } else {
            console.log(`[+] Log stored: ${computer_name} - ${event_type}`);
        }
    });

    // Update active devices
    updateActiveDevice(device_identifier, computer_name, username, device_type, class_section);

    // Create alert if severity is WARNING or CRITICAL
    if (severity === 'WARNING' || severity === 'CRITICAL') {
        createAlert(device_identifier, computer_name, event_type, details, severity, timestamp);
    }
}

/**
 * Update active device status
 */
function updateActiveDevice(device_identifier, computer_name, username, device_type, class_section) {
    db.run(`
        INSERT OR REPLACE INTO active_devices (
            device_identifier, computer_name, username, device_type, class_section, last_seen, status
        ) VALUES (?, ?, ?, ?, ?, datetime('now'), 'ACTIVE')
    `, [device_identifier, computer_name, username, device_type, class_section]);
}

/**
 * Create alert for suspicious activity
 */
function createAlert(device_identifier, computer_name, alert_type, details, severity, timestamp) {
    let message = '';
    
    switch(alert_type) {
        case 'WINDOW_SWITCH':
            message = `Switched from ${details.from} to ${details.to}`;
            break;
        case 'UNAUTHORIZED_APP':
            const apps = details.processes || [];
            // Get unique apps only
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
        if (err) {
            console.error('[-] Error creating alert:', err);
        } else {
            // Broadcast alert to all connected teacher dashboards
            io.emit('new_alert', {
                device_identifier,
                computer_name,
                alert_type,
                message,
                severity,
                timestamp
            });
            console.log(`[!] Alert created: ${computer_name} - ${message}`);
        }
    });
}

/**
 * WebSocket connection handler for student agents
 */
io.on('connection', (socket) => {
    console.log('[+] New connection:', socket.id);
    
    // Store connection info when we receive first message
    socket.deviceInfo = null;

    socket.on('message', (data) => {
        try {
            const message = JSON.parse(data);
            
            if (message.type === 'LOG') {
                // Store device info from first message
                if (!socket.deviceInfo && message.computer_name) {
                    socket.deviceInfo = {
                        computer_name: message.computer_name,
                        username: message.username,
                        device_identifier: message.device_identifier
                    };
                    console.log(`[+] Device identified: ${message.computer_name} (${message.username})`);
                }
                
                // Try to decrypt for real-time display, but store encrypted regardless
                const decryptedLog = decryptLog(message.data);
                
                if (decryptedLog) {
                    // Successfully decrypted - store the decrypted data
                    storeLog(decryptedLog);
                    
                    // Broadcast to teacher dashboards in real-time
                    io.emit('new_log', {
                        device_identifier: message.device_identifier,
                        computer_name: message.computer_name,
                        username: message.username,
                        event_type: decryptedLog.event_type,
                        severity: decryptedLog.severity,
                        timestamp: decryptedLog.timestamp
                    });
                } else {
                    // Decryption failed - store encrypted data with metadata
                    console.log(`[+] Storing encrypted log from ${message.computer_name}`);
                    storeEncryptedLog(message);
                }
            }
        } catch (error) {
            console.error('[-] Error processing message:', error);
        }
    });

    socket.on('disconnect', () => {
        if (socket.deviceInfo) {
            console.log(`[-] Device disconnected: ${socket.deviceInfo.computer_name} (${socket.deviceInfo.username})`);
        } else {
            console.log('[-] Client disconnected:', socket.id);
        }
    });
});

/**
 * REST API Endpoints for Teacher Dashboard
 */

// Get all active devices
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

// Get logs for a specific device
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

// Get all alerts
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

// Acknowledge an alert
app.post('/api/alerts/:id/acknowledge', (req, res) => {
    const { id } = req.params;

    db.run(`
        UPDATE alerts 
        SET acknowledged = 1
        WHERE id = ?
    `, [id], (err) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ success: true });
        }
    });
});

// Get session logs (all logs from a specific session)
app.get('/api/session/:session_id', (req, res) => {
    const { session_id } = req.params;

    db.all(`
        SELECT * FROM logs 
        WHERE session_id = ?
        ORDER BY timestamp ASC
    `, [session_id], (err, rows) => {
        if (err) {
            res.status(500).json({ error: err.message });
        } else {
            res.json({ logs: rows });
        }
    });
});

// Get statistics
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

// Health check endpoint
app.get('/health', (req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * Start server
 */
server.listen(PORT, '0.0.0.0', () => {
    console.log(`[+] Server running on http://0.0.0.0:${PORT}`);
    console.log(`[+] WebSocket endpoint: ws://0.0.0.0:${PORT}`);
    console.log('[+] Ready to receive logs from student agents');
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\n[-] Shutting down server...');
    db.close((err) => {
        if (err) {
            console.error('[-] Error closing database:', err);
        } else {
            console.log('[+] Database closed');
        }
        process.exit(0);
    });
});