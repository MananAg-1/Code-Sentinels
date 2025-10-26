require('dotenv').config();
const express = require('express');
const multer = require('multer');
const sqlite3 = require('sqlite3').verbose();
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const http = require('http');
const cors = require('cors');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// ===== AES SETUP =====
const AES_KEY_BASE64 = process.env.AES_KEY_BASE64;
if (!AES_KEY_BASE64) {
  console.error('AES_KEY_BASE64 not set in .env');
  process.exit(1);
}
const AES_KEY = Buffer.from(AES_KEY_BASE64, 'base64');
if (AES_KEY.length !== 32) {
  console.error('AES_KEY must be 32 bytes (base64 encoded)');
  process.exit(1);
}

// ===== SQLITE SETUP =====
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'files.db');
const db = new sqlite3.Database(DB_PATH);
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS files (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    filename TEXT NOT NULL,
    mimetype TEXT,
    data BLOB NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    uploaded_at DATETIME DEFAULT CURRENT_TIMESTAMP
  )`);
});

// ===== MULTER SETUP =====
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50*1024*1024 } });

// ===== FILE ROUTES =====
app.get('/files', (req,res) => {
  db.all('SELECT id, filename, mimetype, uploaded_at FROM files ORDER BY uploaded_at DESC', (err,rows) => {
    if(err) return res.status(500).json({error:'DB error'});
    res.json(rows);
  });
});

app.post('/upload', upload.single('file'), (req,res) => {
  if(!req.file) return res.status(400).json({error:'No file uploaded'});
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', AES_KEY, iv);
    const encrypted = Buffer.concat([cipher.update(req.file.buffer), cipher.final()]);
    const authTag = cipher.getAuthTag();
    const stmt = db.prepare('INSERT INTO files (filename,mimetype,data,iv,auth_tag) VALUES (?,?,?,?,?)');
    stmt.run(req.file.originalname, req.file.mimetype||'application/octet-stream', encrypted, iv.toString('base64'), authTag.toString('base64'), function(err){
      if(err) return res.status(500).json({error:'DB insert error'});
      res.json({success:true, id:this.lastID});
    });
    stmt.finalize();
  } catch(e) { console.error(e); res.status(500).json({error:'Encryption error'}); }
});

app.get('/download/:id', (req,res) => {
  const id = Number(req.params.id);
  db.get('SELECT filename,mimetype,data,iv,auth_tag FROM files WHERE id=?',[id], (err,row)=>{
    if(err) return res.status(500).send('DB error');
    if(!row) return res.status(404).send('Not found');
    try{
      const iv = Buffer.from(row.iv,'base64');
      const authTag = Buffer.from(row.auth_tag,'base64');
      const decipher = crypto.createDecipheriv('aes-256-gcm',AES_KEY,iv);
      decipher.setAuthTag(authTag);
      const decrypted = Buffer.concat([decipher.update(row.data), decipher.final()]);
      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(row.filename)}"`);
      res.setHeader('Content-Type', row.mimetype||'application/octet-stream');
      res.send(decrypted);
    }catch(e){ console.error('Decryption error',e); res.status(500).send('Decryption failed'); }
  });
});

// ===== LOGGING =====
const LOGS_DIR = path.join(__dirname,'logs');
if(!fs.existsSync(LOGS_DIR)) fs.mkdirSync(LOGS_DIR);

app.post('/log',(req,res)=>{
  try{
    const log = req.body;
    if(!log||!log.event) return res.status(400).json({error:'Invalid log format'});
    const ts = new Date(log.timestamp||Date.now()).toISOString();
    const line = `${ts} | ${log.event} | ${JSON.stringify(log.details)}\n`;
    fs.appendFile(path.join(LOGS_DIR,'activity_logs.txt'),line,(err)=>{if(err) console.error('Failed to save log',err);});
    io.emit('new_log',{timestamp:ts,event:log.event,details:log.details});
    res.json({status:'ok'});
  }catch(err){ console.error('Log error',err); res.status(500).json({error:'Internal error'}); }
});

// ===== ACTIVITY LOGGER =====
let activityLogs = [];

app.post('/api/activity-log', (req,res)=>{
  try{
    const log = req.body;
    if(!log || !log.timestamp || !log.application || !log.window) return res.status(400).json({error:'Invalid log format'});
    activityLogs.push(log);
    if(activityLogs.length>500) activityLogs.shift();
    io.emit('new_activity', log);
    res.json({status:'ok'});
  }catch(err){ console.error(err); res.status(500).json({error:'Internal error'}); }
});

app.get('/api/activity-log',(req,res)=>res.json(activityLogs));

// ===== EXAM MODE CONTROL =====
let exam_active = false;

app.post('/api/exam-mode', (req,res)=>{
  try{
    const {exam_active:newMode} = req.body;
    if(typeof newMode !== "boolean") return res.status(400).json({error:"Invalid exam_active value"});
    exam_active = newMode;
    io.emit('exam_mode_changed',{exam_active});
    console.log(`Exam mode set to: ${exam_active}`);
    res.json({success:true});
  }catch(err){ console.error(err); res.status(500).json({error:'Internal error'});}
});

app.get('/api/exam-status',(req,res)=>res.json({exam_active}));

// ===== SOCKET HANDLER =====
io.on('connection',(socket)=>{
  console.log('Dashboard connected');
  socket.emit('exam_mode_changed',{exam_active});
  socket.emit('initial_activity_logs',activityLogs);
  socket.on('disconnect',()=>console.log('Dashboard disconnected'));
});

// ===== HEALTH CHECK =====
app.get('/health',(req,res)=>res.send('OK'));

// ===== START SERVER =====
const PORT = process.env.PORT || 3000;
server.listen(PORT,()=>console.log(`✅ Server running on http://localhost:${PORT}`));
