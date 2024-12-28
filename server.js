const express = require('express');
const mysql = require('mysql');
const os = require('os');
const bodyParser = require('body-parser');
const cors = require('cors');
const http = require('http');
const { Server } = require('socket.io');
require('dotenv').config();

const app = express();
const port = 3000;
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

app.use(cors());
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());

// Set up koneksi ke MySQL
const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_DATABASE,
});

db.connect((err) => {
  if (err) throw err;
  console.log('Connected to MySQL');
});

// Emit data ke semua klien
function emitParkingData() {
  const query = 'SELECT * FROM parkir_records ORDER BY time_in DESC';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching records:', err);
    } else {
      io.emit('parkingData', results);
    }
  });
}

// Route untuk menerima UID dan menyimpannya ke database
app.post('/enter', (req, res) => {
  const uid = req.body.uid;
  const query = 'INSERT INTO parkir_records (uid) VALUES (?)';

  db.query(query, [uid], (err, result) => {
    if (err) {
      console.error('Error inserting record:', err);
      res.status(500).send('Error processing your entry');
    } else {
      emitParkingData();
      res.send('Entry logged successfully');
    }
  });
});

// Route untuk menghandle waktu keluar dan menghitung biaya
app.post('/exit', (req, res) => {
  const uid = req.body.uid;
  const queryCheck = 'SELECT * FROM parkir_records WHERE uid = ? AND time_out IS NULL ORDER BY time_in DESC LIMIT 1';

  db.query(queryCheck, [uid], (err, results) => {
    if (err) {
      console.error('Database error checking record:', err);
      res.status(500).send('Database error checking record');
      return;
    }
    if (results.length > 0) {
      const record = results[0];
      const queryUpdate = 'UPDATE parkir_records SET time_out = NOW() WHERE id = ?';

      db.query(queryUpdate, [record.id], (err) => {
        if (err) {
          console.error('Error processing your exit:', err);
          res.status(500).send('Error processing your exit');
          return;
        }
        const queryCalc = 'SELECT TIMESTAMPDIFF(SECOND, time_in, time_out) AS duration FROM parkir_records WHERE id = ?';

        db.query(queryCalc, [record.id], (err, results) => {
          if (err || results.length === 0) {
            console.error('Error calculating parking duration:', err);
            res.status(500).send('Error calculating parking duration');
            return;
          }
          const duration = results[0].duration;
          const paidAmount = duration * 1000;

          const queryPay = 'UPDATE parkir_records SET paid_amount = ? WHERE id = ?';
          db.query(queryPay, [paidAmount, record.id], (err) => {
            if (err) {
              console.error('Error updating payment info:', err);
              res.status(500).send('Error updating payment info');
              return;
            }
            emitParkingData();
            res.send(`Please pay: ${paidAmount}`);
          });
        });
      });
    } else {
      res.status(404).send('No entry record found for this UID');
    }
  });
});

// Route untuk mendapatkan data parkir
app.get('/records', (req, res) => {
  const query = 'SELECT * FROM parkir_records ORDER BY time_in DESC';
  db.query(query, (err, results) => {
    if (err) {
      console.error('Error fetching records:', err);
      res.status(500).send('Error fetching records');
    } else {
      res.json(results);
    }
  });
});

// Socket.IO connection
io.on('connection', (socket) => {
  console.log('A user connected');
  emitParkingData();

  socket.on('disconnect', () => {
    console.log('A user disconnected');
  });
});

// Start server

server.listen(port, () => {
  const networkInterfaces = os.networkInterfaces();
  const ipAddresses = Object.values(networkInterfaces)
    .flat()
    .filter((iface) => iface.family === 'IPv4' && !iface.internal)
    .map((iface) => iface.address);

  console.log(`Server running on:`);
  console.log(`- Local: http://localhost:${port}`);
  ipAddresses.forEach((ip) => {
    console.log(`- Network: http://${ip}:${port}`);
  });
});
