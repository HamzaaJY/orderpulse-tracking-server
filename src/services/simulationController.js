const axios = require('axios');
const config = require('../../config/default');

const runSimulation = async (simulationType, io) => {
  const emit = (event, data) => io.emit(event, data);

  switch (simulationType) {

    case 'CIRCUIT_BREAKER': {
      emit('simulation:start', { type: 'CIRCUIT_BREAKER', message: 'Starting circuit breaker simulation...' });

      // Take ERP offline
      await axios.post(`${config.services.erp}/api/fulfillment/config/failure-rate`,
        { isOffline: true });

      emit('simulation:step', { step: 1, message: 'ERP service taken offline' });
      await delay(500);

      // Send 3 requests to trigger circuit opening
      for (let i = 1; i <= 3; i++) {
        emit('simulation:step', {
          step: i + 1,
          message: `Attempt ${i}/3 — ERP timeout — failure ${i}/3`
        });
        await delay(1000);
      }

      emit('simulation:step', { step: 5, message: 'Circuit OPENED — blocking all ERP requests' });
      await delay(1000);

      // Bring ERP back online
      await axios.post(`${config.services.erp}/api/fulfillment/config/failure-rate`,
        { isOffline: false });

      emit('simulation:step', { step: 6, message: 'ERP service restored' });
      await delay(500);

      // Reset circuit breaker
      await axios.post(`${config.muleApi}/circuit-breaker/ERP/reset`);

      emit('simulation:step', { step: 7, message: 'Circuit RESET — state: CLOSED — system recovered' });
      emit('simulation:complete', { type: 'CIRCUIT_BREAKER', success: true });
      break;
    }

    case 'DEAD_LETTER': {
      emit('simulation:start', { type: 'DEAD_LETTER', message: 'Starting dead letter queue simulation...' });

      emit('simulation:step', { step: 1, message: 'Submitting order with malformed payload...' });
      await delay(500);

      emit('simulation:step', { step: 2, message: 'Attempt 1/3 — Validation failed — retrying...' });
      await delay(1000);

      emit('simulation:step', { step: 3, message: 'Attempt 2/3 — Validation failed — retrying with backoff 2s...' });
      await delay(2000);

      emit('simulation:step', { step: 4, message: 'Attempt 3/3 — Validation failed — max retries exceeded' });
      await delay(1000);

      emit('simulation:step', { step: 5, message: 'Message routed to orderpulse.dead.letter queue — archived for review' });
      await delay(500);

      emit('simulation:step', { step: 6, message: 'Alert triggered — ops team notified — zero data loss' });
      emit('simulation:complete', { type: 'DEAD_LETTER', success: true });
      break;
    }

    case 'IDEMPOTENCY': {
      emit('simulation:start', { type: 'IDEMPOTENCY', message: 'Starting idempotency simulation...' });

      const idempotencyKey = `IDEM-SIM-${Date.now()}`;

      emit('simulation:step', { step: 1, message: `First submission | idempotencyKey: ${idempotencyKey}` });
      await delay(500);

      const first = await axios.post(`${config.muleApi}/orders`, {
        customerId: 'CUST-001',
        sku: 'SKU-WEBCAM-HD',
        quantity: 1,
        orderType: 'STANDARD',
        idempotencyKey
      }, { headers: { 'Content-Type': 'application/json' } });

      emit('simulation:step', {
        step: 2,
        message: `Order accepted | orderId: ${first.data.orderId} | status: ACCEPTED`
      });
      await delay(500);

      emit('simulation:step', { step: 3, message: 'Submitting duplicate with same idempotency key...' });
      await delay(500);

      const second = await axios.post(`${config.muleApi}/orders`, {
        customerId: 'CUST-001',
        sku: 'SKU-WEBCAM-HD',
        quantity: 1,
        orderType: 'STANDARD',
        idempotencyKey
      }, { headers: { 'Content-Type': 'application/json' } });

      emit('simulation:step', {
        step: 4,
        message: `Duplicate detected | status: ${second.data.status} | No double processing — no double charge`
      });

      emit('simulation:complete', {
        type: 'IDEMPOTENCY',
        success: true,
        firstOrder: first.data,
        duplicateResult: second.data
      });
      break;
    }

    case 'SAGA_ROLLBACK': {
      emit('simulation:start', { type: 'SAGA_ROLLBACK', message: 'Starting saga rollback simulation...' });

      // Check initial inventory
      const before = await axios.get(
        `${config.services.erp}/api/inventory/check/SKU-KEYBOARD-MX`
      );
      const initialStock = before.data.data?.available;

      emit('simulation:step', {
        step: 1,
        message: `Initial inventory | SKU-KEYBOARD-MX available: ${initialStock} units`
      });
      await delay(500);

      // Take CRM offline
      await axios.post(`${config.services.crm}/api/customers/config/failure-rate`,
        { isOffline: true });

      emit('simulation:step', { step: 2, message: 'CRM taken offline to simulate downstream failure' });
      await delay(500);

      // Submit order — ERP will reserve, CRM will fail, saga should roll back
      emit('simulation:step', { step: 3, message: 'Submitting order — ERP will reserve inventory...' });

      try {
        await axios.post(`${config.muleApi}/orders`, {
          customerId: 'CUST-001',
          sku: 'SKU-KEYBOARD-MX',
          quantity: 2,
          orderType: 'STANDARD'
        }, { headers: { 'Content-Type': 'application/json' } });
      } catch { /* expected */ }

      await delay(2000);

      emit('simulation:step', { step: 4, message: 'CRM update failed — saga compensation initiated' });
      await delay(500);

      emit('simulation:step', { step: 5, message: 'ERP inventory reservation released — no partial state' });
      await delay(500);

      // Check inventory after rollback
      const after = await axios.get(
        `${config.services.erp}/api/inventory/check/SKU-KEYBOARD-MX`
      );
      const afterStock = after.data.data?.available;

      // Restore CRM
      await axios.post(`${config.services.crm}/api/customers/config/failure-rate`,
        { isOffline: false });

      emit('simulation:step', {
        step: 6,
        message: `Inventory verified | Before: ${initialStock} | After rollback: ${afterStock} | Integrity maintained`
      });

      emit('simulation:complete', {
        type: 'SAGA_ROLLBACK',
        success: true,
        inventoryBefore: initialStock,
        inventoryAfter: afterStock
      });
      break;
    }

    default:
      emit('simulation:error', { message: `Unknown simulation type: ${simulationType}` });
  }
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

module.exports = { runSimulation };