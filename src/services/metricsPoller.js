const axios = require('axios');
const config = require('../../config/default');

// Track active polling intervals per userId
// Map<userId, intervalId>
const userPollingIntervals = new Map();

/**
 * Start per-user metrics polling.
 * Called when a user joins their Socket.IO room.
 * Emits metrics:update only to that user's room.
 */

const lastKnownMetrics = new Map();
const startUserPolling = (io, userId) => {
  // Already polling for this user
  if (userPollingIntervals.has(userId)) return;

  console.log(`[METRICS POLLER] Starting polling for userId: ${userId}`);

  const interval = setInterval(async () => {
    try {
      const headers = { 'x-user-id': userId };

      const [analyticsRes, erpRes, crmRes, warehouseRes] = await Promise.allSettled([
        axios.get(`${config.services.analytics}/api/analytics/metrics`, { headers }),
        axios.get(`${config.services.erp}/health`,                       { headers }),
        axios.get(`${config.services.crm}/health`,                       { headers }),
        axios.get(`${config.services.warehouse}/health`,                  { headers }),
      ]);

      const currentAnalytics = analyticsRes.status === 'fulfilled'
        ? analyticsRes.value.data.data
        : lastKnownMetrics.get(userId)?.analytics || null;

      const metrics = {
        timestamp: new Date().toISOString(),
        userId,
        analytics: currentAnalytics,
    
        services: {
          erp: {
            status: erpRes.status === 'fulfilled'
              ? erpRes.value.data.data?.status
              : 'OFFLINE',
            config: erpRes.status === 'fulfilled'
              ? erpRes.value.data.data?.config
              : null,
          },
          crm: {
            status: crmRes.status === 'fulfilled'
              ? crmRes.value.data.data?.status
              : 'OFFLINE',
            config: crmRes.status === 'fulfilled'
              ? crmRes.value.data.data?.config
              : null,
          },
          warehouse: {
            status: warehouseRes.status === 'fulfilled'
              ? warehouseRes.value.data.data?.status
              : 'OFFLINE',
            config: warehouseRes.status === 'fulfilled'
              ? warehouseRes.value.data.data?.config
              : null,
          },
        },
      };

      if (currentAnalytics) {
        lastKnownMetrics.set(userId, metrics);
      }

      // Emit ONLY to this user's room — not globally
      io.to(userId).emit('metrics:update', metrics);

    } catch (error) {
      console.error(`[METRICS POLLER] Error for userId ${userId}:`, error.message);
    }
  }, config.polling.metrics);

  userPollingIntervals.set(userId, interval);
};




/**
 * Stop polling for a specific user.
 * Called when their socket disconnects.
 */
const stopUserPolling = (userId) => {
  const interval = userPollingIntervals.get(userId);
  if (interval) {
    clearInterval(interval);
    userPollingIntervals.delete(userId);
    console.log(`[METRICS POLLER] Stopped polling for userId: ${userId}`);
  }
};

/**
 * Stop all polling intervals (server shutdown).
 */
const stopAllPolling = () => {
  for (const [userId, interval] of userPollingIntervals.entries()) {
    clearInterval(interval);
    lastKnownMetrics.delete(userId);
    console.log(`[METRICS POLLER] Stopped polling for userId: ${userId}`);
  }
  userPollingIntervals.clear();
};

/**
 * Get count of actively polled users (for monitoring).
 */
const getActivePollerCount = () => userPollingIntervals.size;

module.exports = {
  startUserPolling,
  stopUserPolling,
  stopAllPolling,
  getActivePollerCount,
};