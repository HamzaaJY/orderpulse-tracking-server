const express = require('express');
const router = express.Router();
const { submitOrder } = require('../services/orderTracker');
const { getExecution, getAllExecutions, getActiveOrders } = require('../services/executionLogger');

// POST /orders — submit order via REST (not WebSocket)
router.post('/', async (req, res) => {
  const result = await submitOrder(req.body, req.app.get('io'));
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