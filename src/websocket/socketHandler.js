const { submitOrder } = require('../services/orderTracker');
const { runSimulation } = require('../services/simulationController');
const { getExecution, getAllExecutions, getActiveOrders } = require('../services/executionLogger');
const { getLastMetrics } = require('../services/metricsPoller');

const setupSocketHandlers = (io) => {

  io.on('connection', (socket) => {
    console.log(`[WEBSOCKET] Client connected | id: ${socket.id}`);

    // Send current metrics immediately on connect
    const metrics = getLastMetrics();
    if (metrics) socket.emit('metrics:update', metrics);

    // Send active orders on connect
    const activeOrders = getActiveOrders();
    if (activeOrders.length > 0) {
      socket.emit('orders:active', activeOrders);
    }

    // Client submits an order through the tracking server
    socket.on('order:submit', async (orderData) => {
      console.log(`[WEBSOCKET] Order submit request | customer: ${orderData.customerId}`);
      await submitOrder(orderData, io);
    });

    // Client requests execution trace for a specific order
    socket.on('order:trace', (orderId) => {
      const execution = getExecution(orderId);
      if (execution) {
        socket.emit('order:trace:response', execution);
      } else {
        socket.emit('order:trace:response', { error: `No execution found for order: ${orderId}` });
      }
    });

    // Client requests all recent executions
    socket.on('executions:list', () => {
      const executions = getAllExecutions(20);
      socket.emit('executions:list:response', executions);
    });

    // Client triggers a pattern simulation
    socket.on('simulation:run', async ({ type }) => {
      console.log(`[WEBSOCKET] Simulation requested | type: ${type}`);
      await runSimulation(type, io);
    });

    // Client requests current service health
    socket.on('services:health', async () => {
      const metrics = getLastMetrics();
      socket.emit('services:health:response', metrics?.services || null);
    });

    socket.on('disconnect', () => {
      console.log(`[WEBSOCKET] Client disconnected | id: ${socket.id}`);
    });

  });
};

module.exports = { setupSocketHandlers };