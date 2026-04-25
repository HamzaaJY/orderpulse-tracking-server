const express = require('express');
const router = express.Router();
const axios = require('axios');
const config = require('../../config/default');
const { getLastMetrics } = require('../services/metricsPoller');

// GET /metrics — cached metrics
router.get('/', (req, res) => {
  const metrics = getLastMetrics();
  if (!metrics) return res.status(503).json({ error: 'Metrics not yet available' });
  res.json(metrics);
});

// GET /metrics/live — force fresh metrics fetch
router.get('/live', async (req, res) => {
  try {
    const [analyticsRes, erpRes, crmRes, warehouseRes] = await Promise.allSettled([
      axios.get(`${config.services.analytics}/api/analytics/metrics`),
      axios.get(`${config.services.erp}/health`),
      axios.get(`${config.services.crm}/health`),
      axios.get(`${config.services.warehouse}/health`)
    ]);

    res.json({
      timestamp: new Date().toISOString(),
      analytics: analyticsRes.status === 'fulfilled' ? analyticsRes.value.data.data : null,
      services: {
        erp: erpRes.status === 'fulfilled' ? erpRes.value.data.data : { status: 'OFFLINE' },
        crm: crmRes.status === 'fulfilled' ? crmRes.value.data.data : { status: 'OFFLINE' },
        warehouse: warehouseRes.status === 'fulfilled' ? warehouseRes.value.data.data : { status: 'OFFLINE' }
      }
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;