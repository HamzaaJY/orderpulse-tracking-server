require('dotenv').config();

module.exports = {
  port: process.env.PORT || 4000,
  muleApi: process.env.MULE_API_BASE || 'http://localhost:8081/api/v1',
  services: {
    erp: process.env.ERP_SERVICE || 'http://localhost:3001',
    crm: process.env.CRM_SERVICE || 'http://localhost:3002',
    warehouse: process.env.WAREHOUSE_SERVICE || 'http://localhost:3003',
    analytics: process.env.ANALYTICS_SERVICE || 'http://localhost:3004'
  },
  polling: {
    metrics: parseInt(process.env.METRICS_POLL_INTERVAL) || 3000,
    order: parseInt(process.env.ORDER_POLL_INTERVAL) || 2000
  }
};