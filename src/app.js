const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const helmet = require('helmet');
const config = require('../config/default');
const { setupSocketHandlers } = require('./websocket/socketHandler');
const { startPolling } = require('./services/metricsPoller');

// Routes
const ordersRouter = require('./routes/orders');
const metricsRouter = require('./routes/metrics');
const simulationRouter = require('./routes/simulation');
const healthRouter = require('./routes/health');

const app = express();
const server = http.createServer(app);

// Socket.IO setup
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// Make io available to routes
app.set('io', io);
app.set('muleApi', config.muleApi);

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*' }));
app.use(express.json());

// Request logger
app.use((req, res, next) => {
  console.log(`[HTTP] ${req.method} ${req.path} | ${new Date().toISOString()}`);
  next();
});

// Routes
app.use('/health', healthRouter);
app.use('/orders', ordersRouter);
app.use('/metrics', metricsRouter);
app.use('/simulation', simulationRouter);

// RabbitMQ Proxy Bridge (Fixes CORS for the DLQ Check)
app.get('/api/rabbit-status', async (req, res) => {
  const userId = req.headers['x-user-id']; // The frontend must send this!

  if (!userId) {
    return res.status(400).json({ error: "Missing x-user-id header" });
  }

  try {
    // We use the "get" endpoint of the RabbitMQ API to peek at messages
    const response = await fetch('http://localhost:15672/api/queues/%2F/orderpulse.dead.letter/get', {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from('orderpulse:orderpulse123').toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        count: 50,      // Look at the last 50 failed messages
        ackmode: 'ack_requeue_true', // CRITICAL: Peeks without deleting the message
        encoding: 'auto',
        truncate: 50000
      })
    });

    if (!response.ok) throw new Error('RabbitMQ Management API unreachable');
    
    const messages = await response.json();

    // Filter messages that belong to THIS user
    const userDeadLetters = messages.filter(msg => {
      // RabbitMQ messages store the original body as a string in 'payload'
      try {
        const body = JSON.parse(msg.payload);
        return body.userId === userId;
      } catch (e) {
        return false;
      }
    });

    res.json({ 
      messages: userDeadLetters.length,
      totalInQueue: messages.length // Optional: for debugging
    });

  } catch (error) {
    console.error('[DLQ PROXY ERROR]', error.message);
    res.status(500).json({ error: "Cannot filter DLQ" });
  }
});
// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: `Route ${req.method} ${req.path} not found` });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('[ERROR]', err.message);
  res.status(500).json({ error: 'Internal server error' });
});

// Setup WebSocket handlers
setupSocketHandlers(io);

// Start metrics polling
process.on('SIGTERM', () => {
  stopAllPolling();
  server.close();
});

// Start server
server.listen(config.port, () => {
  console.log(`
╔══════════════════════════════════════════════════════╗
║         OrderPulse Tracking Server                   ║
║                                                      ║
║  HTTP:      http://localhost:${config.port}                 ║
║  WebSocket: ws://localhost:${config.port}                   ║
║  Health:    http://localhost:${config.port}/health          ║
╚══════════════════════════════════════════════════════╝
  `);
});

module.exports = { app, server, io };