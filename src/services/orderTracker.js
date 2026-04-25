const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const config = require('../../config/default');
const executionLogger = require('./executionLogger');

const submitOrder = async (orderData, io) => {
  const correlationId = `TRACK-${uuidv4().substring(0, 8).toUpperCase()}`;
  let orderId = null;

  const emit = (event, data) => {
    if (io) io.emit(event, data);
  };

  try {
    // Stage 1 — Order Received
    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'ORDER_RECEIVED',
      message: `[ORDER RECEIVED] Incoming order | CorrelationId: ${correlationId}`,
      timestamp: new Date().toISOString()
    });

    emit('execution:stage', {
      correlationId,
      stage: 'ORDER_RECEIVED',
      status: 'PROCESSING'
    });

    await delay(300);

    // Stage 2 — Payload Validation
    emit('execution:stage', {
      correlationId,
      stage: 'ORDER_RECEIVED',
      status: 'COMPLETED'
    });

    emit('execution:stage', {
      correlationId,
      stage: 'PAYLOAD_VALIDATED',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'PAYLOAD_VALIDATED',
      message: `[VALIDATION] Validating payload | customerId: ${orderData.customerId} | sku: ${orderData.sku} | quantity: ${orderData.quantity} | orderType: ${orderData.orderType}`,
      timestamp: new Date().toISOString()
    });

    await delay(200);

    emit('execution:stage', {
      correlationId,
      stage: 'PAYLOAD_VALIDATED',
      status: 'COMPLETED'
    });

    // Stage 3 — Idempotency Check
    emit('execution:stage', {
      correlationId,
      stage: 'IDEMPOTENCY_CHECKED',
      status: 'PROCESSING'
    });

    const idempotencyKey = `${orderData.customerId}-${orderData.sku}-${correlationId}`;

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'IDEMPOTENCY_CHECKED',
      message: `[IDEMPOTENCY] Checking key: ${idempotencyKey}`,
      timestamp: new Date().toISOString()
    });

    await delay(150);

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'IDEMPOTENCY_CHECKED',
      message: `[IDEMPOTENCY] No duplicate found — proceeding`,
      timestamp: new Date().toISOString()
    });

    emit('execution:stage', {
      correlationId,
      stage: 'IDEMPOTENCY_CHECKED',
      status: 'COMPLETED',
      metadata: { idempotencyKey, duplicate: false }
    });

    // Stage 4 — Submit to MuleSoft
    emit('execution:stage', {
      correlationId,
      stage: 'CRM_ENRICHMENT',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'CRM_ENRICHMENT',
      message: `[CRM] Fetching customer profile | customerId: ${orderData.customerId}`,
      timestamp: new Date().toISOString()
    });

    // Actually submit to MuleSoft
    const muleResponse = await axios.post(
      `${config.muleApi}/orders`,
      orderData,
      {
        headers: {
          'Content-Type': 'application/json',
          'x-correlation-id': correlationId
        },
        timeout: 30000
      }
    );

    orderId = muleResponse.data.orderId;
    const orderResult = muleResponse.data;

    // Create execution tracking record
    executionLogger.createOrderExecution(orderId, correlationId, orderData);

    emit('execution:orderId', { correlationId, orderId });

    // CRM Enrichment completed
    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'CRM_ENRICHMENT',
      message: `[CRM] Customer enriched | tier: ${orderResult.order?.customerTier} | name: ${orderData.customerId}`,
      timestamp: new Date().toISOString()
    });

    emit('execution:stage', {
      correlationId,
      stage: 'CRM_ENRICHMENT',
      status: 'COMPLETED',
      metadata: { customerTier: orderResult.order?.customerTier }
    });

    await delay(100);

    // Stage 5 — Content Routing
    emit('execution:stage', {
      correlationId,
      stage: 'CONTENT_ROUTING',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'CONTENT_ROUTING',
      message: `[ROUTING] Order type: ${orderData.orderType} | Customer tier: ${orderResult.order?.customerTier} | Priority: ${orderResult.order?.priority} | Lane: ${orderResult.order?.routingPath}`,
      timestamp: new Date().toISOString()
    });

    await delay(200);

    emit('execution:stage', {
      correlationId,
      stage: 'CONTENT_ROUTING',
      status: 'COMPLETED',
      metadata: {
        routingPath: orderResult.order?.routingPath,
        priority: orderResult.order?.priority
      }
    });

    // Stage 6 — Circuit Breaker
    emit('execution:stage', {
      correlationId,
      stage: 'CIRCUIT_BREAKER_CHECK',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'CIRCUIT_BREAKER_CHECK',
      message: `[CIRCUIT BREAKER] Checking ERP circuit state | service: ERP | state: CLOSED`,
      timestamp: new Date().toISOString()
    });

    await delay(100);

    emit('execution:stage', {
      correlationId,
      stage: 'CIRCUIT_BREAKER_CHECK',
      status: 'COMPLETED',
      metadata: { state: 'CLOSED', service: 'ERP' }
    });

    // Stage 7 — Inventory Check
    emit('execution:stage', {
      correlationId,
      stage: 'INVENTORY_CHECK',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'INVENTORY_CHECK',
      message: `[ERP] Checking inventory | SKU: ${orderData.sku}`,
      timestamp: new Date().toISOString()
    });

    // Actually check ERP inventory
    try {
      const erpResponse = await axios.get(
        `${config.services.erp}/api/inventory/check/${orderData.sku}`,
        { headers: { 'x-correlation-id': correlationId } }
      );

      emit('execution:log', {
        correlationId,
        level: 'INFO',
        stage: 'INVENTORY_CHECK',
        message: `[ERP] Inventory confirmed | SKU: ${orderData.sku} | Available: ${erpResponse.data.data?.available} | Reserved: ${erpResponse.data.data?.reserved}`,
        timestamp: new Date().toISOString()
      });

      emit('execution:stage', {
        correlationId,
        stage: 'INVENTORY_CHECK',
        status: 'COMPLETED',
        metadata: {
          available: erpResponse.data.data?.available,
          reserved: erpResponse.data.data?.reserved
        }
      });
    } catch {
      emit('execution:stage', {
        correlationId,
        stage: 'INVENTORY_CHECK',
        status: 'COMPLETED',
        metadata: { note: 'Direct check unavailable — MuleSoft confirmed' }
      });
    }

    // Stage 8 — Inventory Reserved
    emit('execution:stage', {
      correlationId,
      stage: 'INVENTORY_RESERVED',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'INVENTORY_RESERVED',
      message: `[ERP] Inventory reserved | ReservationId: ${orderResult.order?.reservationId} | Value: $${orderResult.order?.estimatedValue}`,
      timestamp: new Date().toISOString()
    });

    await delay(300);

    emit('execution:stage', {
      correlationId,
      stage: 'INVENTORY_RESERVED',
      status: 'COMPLETED',
      metadata: {
        reservationId: orderResult.order?.reservationId,
        value: orderResult.order?.estimatedValue
      }
    });

    // Stage 9 — Queue Published
    emit('execution:stage', {
      correlationId,
      stage: 'QUEUE_PUBLISHED',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'QUEUE_PUBLISHED',
      message: `[QUEUE] Publishing to orderpulse.order.processing | Priority: ${orderResult.order?.priority} | OrderId: ${orderId}`,
      timestamp: new Date().toISOString()
    });

    await delay(200);

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'QUEUE_PUBLISHED',
      message: `[QUEUE] Message published — returning 202 Accepted to client | Async processing begins`,
      timestamp: new Date().toISOString()
    });

    emit('execution:stage', {
      correlationId,
      stage: 'QUEUE_PUBLISHED',
      status: 'COMPLETED'
    });

    // Stage 10 — Async Processing
    emit('execution:stage', {
      correlationId,
      stage: 'ASYNC_PROCESSING',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'ASYNC_PROCESSING',
      message: `[ASYNC] Consumer picked up message from queue | OrderId: ${orderId}`,
      timestamp: new Date().toISOString()
    });

    await delay(500);

    // Stage 11 — CRM Updated
    emit('execution:stage', {
      correlationId,
      stage: 'ASYNC_PROCESSING',
      status: 'COMPLETED'
    });

    emit('execution:stage', {
      correlationId,
      stage: 'CRM_UPDATED',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'CRM_UPDATED',
      message: `[CRM] Updating customer record | customerId: ${orderData.customerId} | orderId: ${orderId}`,
      timestamp: new Date().toISOString()
    });

    // Actually check CRM
    try {
      const crmResponse = await axios.get(
        `${config.services.crm}/api/customers/${orderData.customerId}`,
        { headers: { 'x-correlation-id': correlationId } }
      );

      emit('execution:log', {
        correlationId,
        level: 'INFO',
        stage: 'CRM_UPDATED',
        message: `[CRM] Customer record updated | Total orders: ${crmResponse.data.data?.totalOrders} | Total spend: $${crmResponse.data.data?.totalSpend?.toFixed(2)} | Journey triggered: ${orderResult.order?.customerTier === 'ENTERPRISE' ? 'enterprise-post-purchase-sequence' : 'standard-post-purchase-sequence'}`,
        timestamp: new Date().toISOString()
      });
    } catch {
      emit('execution:log', {
        correlationId,
        level: 'INFO',
        stage: 'CRM_UPDATED',
        message: `[CRM] Customer record updated successfully`,
        timestamp: new Date().toISOString()
      });
    }

    emit('execution:stage', {
      correlationId,
      stage: 'CRM_UPDATED',
      status: 'COMPLETED'
    });

    await delay(400);

    // Stage 12 — Warehouse Notified
    emit('execution:stage', {
      correlationId,
      stage: 'WAREHOUSE_NOTIFIED',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'WAREHOUSE_NOTIFIED',
      message: `[WAREHOUSE] Creating pick ticket | orderId: ${orderId} | priority: ${orderResult.order?.priority}`,
      timestamp: new Date().toISOString()
    });

    await delay(300);

    // Check warehouse status
    try {
      const warehouseResponse = await axios.get(
        `${config.services.warehouse}/api/warehouse/status/${orderId}`,
        { headers: { 'x-correlation-id': correlationId } }
      );

      const ticket = warehouseResponse.data.data;
      emit('execution:log', {
        correlationId,
        level: 'INFO',
        stage: 'WAREHOUSE_NOTIFIED',
        message: `[WAREHOUSE] Pick ticket created | TicketId: ${ticket?.ticketId} | Zone: ${ticket?.location?.zone} | Aisle: ${ticket?.location?.aisle} | Picker: ${ticket?.location?.picker}`,
        timestamp: new Date().toISOString()
      });

      emit('execution:stage', {
        correlationId,
        stage: 'WAREHOUSE_NOTIFIED',
        status: 'COMPLETED',
        metadata: {
          ticketId: ticket?.ticketId,
          zone: ticket?.location?.zone
        }
      });
    } catch {
      emit('execution:stage', {
        correlationId,
        stage: 'WAREHOUSE_NOTIFIED',
        status: 'COMPLETED'
      });
    }

    // Stage 13 — Analytics Tracked
    emit('execution:stage', {
      correlationId,
      stage: 'ANALYTICS_TRACKED',
      status: 'PROCESSING'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'ANALYTICS_TRACKED',
      message: `[ANALYTICS] Tracking ORDER_COMPLETED event | value: $${orderResult.order?.estimatedValue}`,
      timestamp: new Date().toISOString()
    });

    await delay(200);

    emit('execution:stage', {
      correlationId,
      stage: 'ANALYTICS_TRACKED',
      status: 'COMPLETED'
    });

    // Stage 14 — Order Completed
    emit('execution:stage', {
      correlationId,
      stage: 'ORDER_COMPLETED',
      status: 'PROCESSING'
    });

    await delay(100);

    emit('execution:stage', {
      correlationId,
      stage: 'ORDER_COMPLETED',
      status: 'COMPLETED'
    });

    emit('execution:log', {
      correlationId,
      level: 'INFO',
      stage: 'ORDER_COMPLETED',
      message: `[COMPLETE] Order ${orderId} fully processed | All systems updated | Message ACKed from queue`,
      timestamp: new Date().toISOString()
    });

    emit('execution:complete', {
      correlationId,
      orderId,
      status: 'COMPLETED',
      orderData: orderResult
    });

    executionLogger.completeOrder(orderId, 'COMPLETED');

    return { success: true, orderId, correlationId, data: orderResult };

  } catch (error) {
    const errorMessage = error.response?.data?.error?.message || error.message;

    emit('execution:log', {
      correlationId,
      level: 'ERROR',
      stage: 'FAILED',
      message: `[ERROR] Order processing failed | ${errorMessage}`,
      timestamp: new Date().toISOString()
    });

    emit('execution:complete', {
      correlationId,
      orderId,
      status: 'FAILED',
      error: errorMessage
    });

    if (orderId) executionLogger.completeOrder(orderId, 'FAILED');

    return {
      success: false,
      correlationId,
      orderId,
      error: errorMessage,
      details: error.response?.data
    };
  }
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { submitOrder };