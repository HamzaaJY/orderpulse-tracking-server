const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({
    service: 'OrderPulse Tracking Server',
    status: 'OPERATIONAL',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    websocket: 'ACTIVE',
    endpoints: {
      websocket: 'ws://localhost:4000',
      rest: {
        orders: 'POST /orders',
        trace: 'GET /orders/:orderId/trace',
        metrics: 'GET /metrics',
        simulation: 'POST /simulation/run'
      }
    }
  });
});

module.exports = router;