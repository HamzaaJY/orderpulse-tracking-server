const express = require('express');
const router = express.Router();
const axios = require('axios');
const config = require('../../config/default');
const { runSimulation } = require('../services/simulationController');

// POST /simulation/run — trigger a pattern simulation
router.post('/run', async (req, res) => {
  const { type } = req.body;
  if (!type) return res.status(400).json({ error: 'Simulation type required' });

  const io = req.app.get('io');
  runSimulation(type, io).catch(console.error);

  res.json({
    success: true,
    message: `Simulation ${type} started — watch WebSocket for real-time updates`
  });
});

// POST /simulation/service/:service/offline — take a service offline
router.post('/service/:service/offline', async (req, res) => {
  const { service } = req.params;
  const serviceUrls = {
    erp: `${config.services.erp}/api/fulfillment/config/failure-rate`,
    crm: `${config.services.crm}/api/customers/config/failure-rate`,
    warehouse: `${config.services.warehouse}/api/warehouse/config/failure-rate`,
    analytics: `${config.services.analytics}/api/analytics/config/failure-rate`
  };

  if (!serviceUrls[service]) {
    return res.status(400).json({ error: `Unknown service: ${service}` });
  }

  await axios.post(serviceUrls[service], { isOffline: true });
  res.json({ success: true, service, status: 'OFFLINE' });
});

// POST /simulation/service/:service/online — restore a service
router.post('/service/:service/online', async (req, res) => {
  const { service } = req.params;
  const serviceUrls = {
    erp: `${config.services.erp}/api/fulfillment/config/failure-rate`,
    crm: `${config.services.crm}/api/customers/config/failure-rate`
  };

  if (!serviceUrls[service]) {
    return res.status(400).json({ error: `Unknown service: ${service}` });
  }

  await axios.post(serviceUrls[service], { isOffline: false });
  res.json({ success: true, service, status: 'ONLINE' });
});

// POST /simulation/circuit-breaker/:service/reset
router.post('/circuit-breaker/:service/reset', async (req, res) => {
  const { service } = req.params;
  await axios.post(`${config.muleApi}/circuit-breaker/${service}/reset`);
  res.json({ success: true, service, circuitState: 'CLOSED' });
});

module.exports = router;