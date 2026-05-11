const express = require('express');
const router = express.Router();
const { submitOrder } = require('../services/orderTracker');
const { getExecution, getAllExecutions, getActiveOrders } = require('../services/executionLogger');

// POST /orders — submit order via REST (not WebSocket)
router.post('/', async (req, res) => {

  console.log('--- [ROUTER DEBUG] New Order Request ---');
  console.log('Headers:', JSON.stringify(req.headers, null, 2));
  const userId = req.headers['x-user-id'];
  const correlationId = req.headers['x-correlation-id'];
  console.log(userId)
  console.log(correlationId)
  const result = await submitOrder(req.body, req.app.get('io'),{
    userId, correlationId
  });
  res.status(result.success ? 202 : 400).json(result);
});

// GET /orders/:orderId/trace — get full execution trace
router.get('/:orderId/trace', (req, res) => {
  const execution = getExecution(req.params.orderId);
  if (!execution) return res.status(404).json({ error: 'Execution not found' });
  res.json(execution);
});

// GET /orders — list recent executions
router.get('/', (req, res) => {
  const limit = parseInt(req.query.limit) || 20;
  res.json(getAllExecutions(limit));
});

// GET /orders/active — list active orders
router.get('/active', (req, res) => {
  res.json(getActiveOrders());
});

module.exports = router;