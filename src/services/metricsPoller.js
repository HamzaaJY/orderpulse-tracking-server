const axios = require('axios');
const config = require('../../config/default');

let pollingInterval = null;
let lastMetrics = null;

const startPolling = (io) => {
  if (pollingInterval) return;

  pollingInterval = setInterval(async () => {
    try {
      const [analyticsRes, erpRes, crmRes, warehouseRes] = await Promise.allSettled([
        axios.get(`${config.services.analytics}/api/analytics/metrics`),
        axios.get(`${config.services.erp}/health`),
        axios.get(`${config.services.crm}/health`),
        axios.get(`${config.services.warehouse}/health`)
      ]);

      const metrics = {
        timestamp: new Date().toISOString(),
        analytics: analyticsRes.status === 'fulfilled'
          ? analyticsRes.value.data.data
          : null,
        services: {
          erp: {
            status: erpRes.status === 'fulfilled' ? erpRes.value.data.data?.status : 'OFFLINE',
            config: erpRes.status === 'fulfilled' ? erpRes.value.data.data?.config : null
          },
          crm: {
            status: crmRes.status === 'fulfilled' ? crmRes.value.data.data?.status : 'OFFLINE',
            config: crmRes.status === 'fulfilled' ? crmRes.value.data.data?.config : null
          },
          warehouse: {
            status: warehouseRes.status === 'fulfilled' ? warehouseRes.value.data.data?.status : 'OFFLINE',
            config: warehouseRes.status === 'fulfilled' ? warehouseRes.value.data.data?.config : null
          }
        }
      };

      lastMetrics = metrics;
      io.emit('metrics:update', metrics);

    } catch (error) {
      console.error('[METRICS POLLER] Error:', error.message);
    }
  }, config.polling.metrics);

  console.log(`[METRICS POLLER] Started — polling every ${config.polling.metrics}ms`);
};

const stopPolling = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
  }
};

const getLastMetrics = () => lastMetrics;

module.exports = { startPolling, stopPolling, getLastMetrics };