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
  try {
    // We use fetch to talk to RabbitMQ on port 15672
    const r = await fetch('http://localhost:15672/api/queues/%2F/orderpulse.dead.letter', {
      headers: {
        'Authorization': 'Basic ' + Buffer.from('orderpulse:orderpulse123').toString('base64')
      }
    });
    
    if (!r.ok) throw new Error('RabbitMQ unreachable');
    
    const data = await r.json();
    // Return just the count to the UI
    res.json({ messages: data.messages_ready || 0 });
  } catch (error) {
    console.error('[PROXY ERROR]', error.message);
    res.status(500).json({ error: "Cannot reach RabbitMQ" });
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
startPolling(io);

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