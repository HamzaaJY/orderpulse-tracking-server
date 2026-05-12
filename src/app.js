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

// RabbitMQ Proxy Bridge (CloudAMQP Production Version)
app.get('/api/rabbit-status', async (req, res) => {
  const userId = req.headers['x-user-id'];

  if (!userId) {
    return res.status(400).json({ error: "Missing x-user-id header" });
  }

  // Configuration from Env (falling back to your details for now)
  const RMQ_HOST = process.env.RABBITMQ_MGMT_HOST || 'campbell.lmq.cloudamqp.com';
  const RMQ_USER = process.env.RABBITMQ_USERNAME || 'xoijhjjd';
  const RMQ_PASS = process.env.RABBITMQ_PASSWORD || 'mxp1wJ1VKH43lutUELthuZhNVcISIY4w';
  const RMQ_VHOST = process.env.RABBITMQ_VHOST || 'xoijhjjd';

  // CloudAMQP uses the same host for Mgmt but via HTTPS on port 443 (or standard 15672)
  // The %2F in your local code must be replaced with your specific VHost
  const mgmtUrl = `https://${RMQ_HOST}/api/queues/${RMQ_VHOST}/orderpulse.dead.letter/get`;

  try {
    const response = await fetch(mgmtUrl, {
      method: 'POST',
      headers: {
        'Authorization': 'Basic ' + Buffer.from(`${RMQ_USER}:${RMQ_PASS}`).toString('base64'),
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        count: 50,
        ackmode: 'ack_requeue_true', // Peeks without deleting
        encoding: 'auto',
        truncate: 50000
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`RabbitMQ API Error: ${response.status} - ${errorText}`);
    }
    
    const messages = await response.json();

    // Filter messages that belong to THIS user
    const userDeadLetters = messages.filter(msg => {
      try {
        const body = JSON.parse(msg.payload);
        return body.userId === userId;
      } catch (e) {
        return false;
      }
    });

    res.json({ 
      messages: userDeadLetters.length,
      totalInQueue: messages.length 
    });

  } catch (error) {
    console.error('[DLQ PROXY ERROR]', error.message);
    res.status(500).json({ error: "Cannot filter CloudAMQP DLQ" });
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
