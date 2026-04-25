const { v4: uuidv4 } = require('uuid');

// In-memory store of execution logs per order
const executionLogs = new Map();
const activeOrders = new Map();

const EXECUTION_STAGES = [
  'ORDER_RECEIVED',
  'PAYLOAD_VALIDATED',
  'IDEMPOTENCY_CHECKED',
  'CRM_ENRICHMENT',
  'CONTENT_ROUTING',
  'CIRCUIT_BREAKER_CHECK',
  'INVENTORY_CHECK',
  'INVENTORY_RESERVED',
  'QUEUE_PUBLISHED',
  'ASYNC_PROCESSING',
  'CRM_UPDATED',
  'WAREHOUSE_NOTIFIED',
  'ANALYTICS_TRACKED',
  'ORDER_COMPLETED'
];

const createOrderExecution = (orderId, correlationId, orderData) => {
  const execution = {
    orderId,
    correlationId,
    startedAt: new Date().toISOString(),
    completedAt: null,
    status: 'PROCESSING',
    currentStage: 'ORDER_RECEIVED',
    stages: EXECUTION_STAGES.map(stage => ({
      stage,
      status: 'PENDING',
      startedAt: null,
      completedAt: null,
      durationMs: null,
      metadata: {}
    })),
    logs: [],
    orderData,
    patterns: {
      idempotencyChecked: false,
      circuitBreakerChecked: false,
      contentRoutingApplied: false,
      sagaInitiated: false,
      retryAttempted: false,
      dlqRouted: false
    }
  };

  executionLogs.set(orderId, execution);
  activeOrders.set(orderId, execution);
  return execution;
};

const updateStage = (orderId, stageName, status, metadata = {}) => {
  const execution = executionLogs.get(orderId);
  if (!execution) return null;

  const stage = execution.stages.find(s => s.stage === stageName);
  if (!stage) return null;

  const now = new Date().toISOString();

  if (status === 'PROCESSING' && !stage.startedAt) {
    stage.startedAt = now;
    stage.status = 'PROCESSING';
    execution.currentStage = stageName;
  } else if (status === 'COMPLETED') {
    stage.completedAt = now;
    stage.status = 'COMPLETED';
    if (stage.startedAt) {
      stage.durationMs = new Date(now) - new Date(stage.startedAt);
    }
  } else if (status === 'FAILED') {
    stage.completedAt = now;
    stage.status = 'FAILED';
  } else if (status === 'SKIPPED') {
    stage.status = 'SKIPPED';
  }

  stage.metadata = { ...stage.metadata, ...metadata };
  return execution;
};

const addLog = (orderId, level, message, metadata = {}) => {
  const execution = executionLogs.get(orderId);
  if (!execution) return null;

  const logEntry = {
    id: uuidv4(),
    timestamp: new Date().toISOString(),
    level,
    message,
    metadata
  };

  execution.logs.push(logEntry);

  // Keep only last 100 logs per order
  if (execution.logs.length > 100) {
    execution.logs = execution.logs.slice(-100);
  }

  return logEntry;
};

const completeOrder = (orderId, status = 'COMPLETED') => {
  const execution = executionLogs.get(orderId);
  if (!execution) return null;

  execution.status = status;
  execution.completedAt = new Date().toISOString();
  activeOrders.delete(orderId);

  return execution;
};

const updatePattern = (orderId, pattern, value = true) => {
  const execution = executionLogs.get(orderId);
  if (!execution) return null;
  execution.patterns[pattern] = value;
  return execution;
};

const getExecution = (orderId) => executionLogs.get(orderId) || null;

const getActiveOrders = () => Array.from(activeOrders.values());

const getAllExecutions = (limit = 50) => {
  const all = Array.from(executionLogs.values());
  return all.slice(-limit).reverse();
};

const clearOldExecutions = () => {
  const cutoff = new Date(Date.now() - 60 * 60 * 1000); // 1 hour
  for (const [orderId, execution] of executionLogs.entries()) {
    if (execution.completedAt && new Date(execution.completedAt) < cutoff) {
      executionLogs.delete(orderId);
    }
  }
};

// Clean up old executions every 30 minutes
setInterval(clearOldExecutions, 30 * 60 * 1000);

module.exports = {
  createOrderExecution,
  updateStage,
  addLog,
  completeOrder,
  updatePattern,
  getExecution,
  getActiveOrders,
  getAllExecutions,
  EXECUTION_STAGES
};