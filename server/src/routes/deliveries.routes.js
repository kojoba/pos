import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { recordCashOnDeliveryCollection } from '../order-service.js';
import { deliveryCodeExpired, matchesDeliveryCode, newDeliveryCode } from '../delivery-code.js';
import { sendDeliveryCodeEmail } from '../email-service.js';

const router = Router();
const transitions = { assigned: 'picked_up', picked_up: 'en_route', en_route: 'delivered' };

function deliveryForUser(id, auth) {
  const delivery = db.prepare('SELECT * FROM deliveries WHERE id=?').get(id);
  if (!delivery) return { error: 'Delivery not found.', status: 404 };
  if (auth.role === 'rider' && delivery.rider_id !== auth.id) return { error: 'This delivery belongs to another rider.', status: 403 };
  return { delivery };
}

async function sendFreshCode(order) {
  if (!order.customer_email) throw new Error('This order has no customer email. Ask the manager to update the order email before starting delivery.');
  const challenge = newDeliveryCode(order.id);
  await sendDeliveryCodeEmail({ to: order.customer_email, customerName: order.customer_name, orderRef: order.ref, code: challenge.code });
  return { ...challenge, sentAt: new Date().toISOString() };
}

router.get('/', requireAuth, requireRole('manager', 'rider'), (req, res) => {
  const rows = req.auth.role === 'manager'
    ? db.prepare(`SELECT d.*,o.ref,o.customer_name,o.customer_phone,o.customer_email,o.total_pesewas,o.delivery_address,o.delivery_instructions,o.delivery_fee_pesewas,o.payment_method,o.status AS order_status,o.paid_at,o.cash_collected_by_name,u.name AS rider_name,
      (SELECT GROUP_CONCAT(oi.product_name || ' ×' || oi.quantity, ', ') FROM order_items oi WHERE oi.order_id=o.id) AS item_summary
      FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=d.rider_id ORDER BY d.id DESC`).all()
    : db.prepare(`SELECT d.*,o.ref,o.customer_name,o.customer_phone,o.customer_email,o.total_pesewas,o.delivery_address,o.delivery_instructions,o.delivery_fee_pesewas,o.payment_method,o.status AS order_status,o.paid_at,o.cash_collected_by_name,u.name AS rider_name,
      (SELECT GROUP_CONCAT(oi.product_name || ' ×' || oi.quantity, ', ') FROM order_items oi WHERE oi.order_id=o.id) AS item_summary
      FROM deliveries d JOIN orders o ON o.id=d.order_id JOIN users u ON u.id=d.rider_id WHERE d.rider_id=? ORDER BY d.id DESC`).all(req.auth.id);

  res.json({ deliveries: rows.map(d => ({
    id:d.id, orderId:d.order_id, ref:d.ref, customerName:d.customer_name, customerPhone:d.customer_phone,
    customerEmailMissing:!String(d.customer_email||'').trim(),
    total:d.total_pesewas/100, deliveryAddress:d.delivery_address||'', deliveryInstructions:d.delivery_instructions||'',
    deliveryFee:(d.delivery_fee_pesewas||0)/100, items:d.item_summary||'', paymentMethod:d.payment_method,
    orderStatus:d.order_status, paidAt:d.paid_at, cashCollectedBy:d.cash_collected_by_name||'',
    riderId:d.rider_id, riderName:d.rider_name, status:d.status, assignedAt:d.assigned_at,
    pickedUpAt:d.picked_up_at, deliveredAt:d.delivered_at, verificationCodeSent:Boolean(d.delivery_code_sent_at),
  })) });
});

router.patch('/:id/customer-email', requireAuth, requireRole('manager'), (req, res) => {
  const delivery = db.prepare(`SELECT d.status,o.id AS order_id,o.fulfillment_type FROM deliveries d
    JOIN orders o ON o.id=d.order_id WHERE d.id=?`).get(Number(req.params.id));
  if (!delivery) return res.status(404).json({ error:'Delivery not found.' });
  if (delivery.fulfillment_type !== 'delivery') return res.status(400).json({ error:'Customer email can only be added to delivery orders.' });
  if (delivery.status === 'delivered') return res.status(400).json({ error:'A completed delivery cannot be changed.' });
  const email = String(req.body?.customerEmail||'').trim().toLowerCase();
  if (email.length > 254 || !/^\S+@\S+\.\S+$/.test(email)) return res.status(400).json({ error:'Enter a valid customer email address.' });
  db.prepare('UPDATE orders SET customer_email=? WHERE id=?').run(email,delivery.order_id);
  return res.json({ ok:true });
});

router.get('/available-orders', requireAuth, requireRole('manager'), (_req, res) => {
  const orders = db.prepare(`SELECT o.id,o.ref,o.customer_name,o.customer_phone,o.total_pesewas,o.delivery_address,o.delivery_fee_pesewas,o.payment_method,o.status
    FROM orders o LEFT JOIN deliveries d ON d.order_id=o.id
    WHERE d.id IS NULL AND o.status IN ('paid','due') AND o.fulfillment_type='delivery' ORDER BY o.id DESC`).all();
  const riders = db.prepare(`SELECT id,name FROM users WHERE role='rider' AND active=1 ORDER BY name`).all();
  res.json({ orders:orders.map(o=>({ ...o, customerName:o.customer_name, customerPhone:o.customer_phone,
    deliveryAddress:o.delivery_address, deliveryFee:(o.delivery_fee_pesewas||0)/100, total:o.total_pesewas/100,
    paymentMethod:o.payment_method, orderStatus:o.status })), riders });
});

router.post('/', requireAuth, requireRole('manager'), (req, res) => {
  const orderId = Number(req.body?.orderId), riderId = Number(req.body?.riderId);
  const order = db.prepare(`SELECT id FROM orders WHERE id=? AND status IN ('paid','due') AND fulfillment_type='delivery'`).get(orderId);
  const rider = db.prepare(`SELECT id FROM users WHERE id=? AND role='rider' AND active=1`).get(riderId);
  if (!order || !rider) return res.status(400).json({ error:'Choose an eligible delivery order and active rider.' });
  try {
    db.prepare('INSERT INTO deliveries(order_id,rider_id) VALUES(?,?)').run(orderId,riderId);
    res.status(201).json({ ok:true });
  } catch (error) {
    if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') return res.status(409).json({ error:'A rider is already assigned to this sale.' });
    throw error;
  }
});

router.post('/:id/resend-code', requireAuth, requireRole('manager','rider'), async (req, res) => {
  const { delivery, error, status } = deliveryForUser(Number(req.params.id), req.auth);
  if (error) return res.status(status).json({ error });
  if (delivery.status !== 'en_route') return res.status(400).json({ error:'The customer code can be resent after the rider starts the trip.' });
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(delivery.order_id);
  const lastSentAt = Date.parse(order.delivery_code_sent_at || '');
  if (Number.isFinite(lastSentAt) && Date.now() - lastSentAt < 60_000) {
    return res.status(429).json({ error:'Wait one minute before requesting another code.' });
  }
  try {
    const challenge = await sendFreshCode(order);
    db.prepare(`UPDATE orders SET delivery_code_hash=?,delivery_code_expires_at=?,delivery_code_sent_at=?,delivery_code_attempts=0 WHERE id=?`)
      .run(challenge.hash,challenge.expiresAt,challenge.sentAt,order.id);
    return res.json({ ok:true, message:'A new delivery code was emailed to the customer.' });
  } catch (sendError) {
    return res.status(503).json({ error:sendError.message || 'The delivery code could not be sent.' });
  }
});

router.patch('/:id/status', requireAuth, requireRole('manager','rider'), async (req, res) => {
  const { delivery, error, status } = deliveryForUser(Number(req.params.id), req.auth);
  if (error) return res.status(status).json({ error });
  const next = String(req.body?.status || '');
  if (transitions[delivery.status] !== next) return res.status(400).json({ error:'That delivery status change is not allowed.' });
  if (req.auth.role === 'manager' && next !== 'delivered') return res.status(403).json({ error:'Managers can only mark a delivery delivered.' });

  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(delivery.order_id);
  if (next === 'en_route') {
    try {
      const challenge = await sendFreshCode(order);
      db.transaction(() => {
        db.prepare(`UPDATE orders SET delivery_code_hash=?,delivery_code_expires_at=?,delivery_code_sent_at=?,delivery_code_attempts=0 WHERE id=?`)
          .run(challenge.hash,challenge.expiresAt,challenge.sentAt,order.id);
        db.prepare(`UPDATE deliveries SET status='en_route' WHERE id=? AND status='picked_up'`).run(delivery.id);
      })();
      return res.json({ ok:true, verificationEmailSent:true });
    } catch (sendError) {
      return res.status(503).json({ error:sendError.message || 'The delivery code could not be emailed.' });
    }
  }

  if (next === 'delivered') {
    const code = String(req.body?.verificationCode || '').trim();
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ error:'Enter the 6-digit code from the customer’s email.' });
    if (order.delivery_code_attempts >= 5) return res.status(429).json({ error:'Too many incorrect attempts. Resend a new code to the customer.' });
    if (deliveryCodeExpired(order.delivery_code_expires_at)) return res.status(410).json({ error:'This code has expired. Resend a new code to the customer.' });
    if (!matchesDeliveryCode(order.id,code,order.delivery_code_hash)) {
      db.prepare('UPDATE orders SET delivery_code_attempts=delivery_code_attempts+1 WHERE id=?').run(order.id);
      return res.status(400).json({ error:`That code is incorrect. ${Math.max(0,4-order.delivery_code_attempts)} attempts remain.` });
    }
    if (order.payment_method === 'Cash on delivery' && order.status === 'due' && req.body?.cashCollected !== true) {
      return res.status(400).json({ error:'Confirm that the rider collected the full cash amount before completing this delivery.' });
    }

    try {
      db.transaction(() => {
        if (order.payment_method === 'Cash on delivery' && order.status === 'due') {
          const collector = db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
          recordCashOnDeliveryCollection(order.id,req.auth.id,collector.name);
        }
        db.prepare(`UPDATE deliveries SET status='delivered',delivered_at=datetime('now') WHERE id=? AND status='en_route'`).run(delivery.id);
        db.prepare(`UPDATE orders SET delivery_code_hash=NULL,delivery_code_expires_at=NULL,delivery_code_sent_at=NULL,delivery_code_attempts=0 WHERE id=?`).run(order.id);
      })();
      return res.json({ ok:true, verificationPassed:true });
    } catch (updateError) {
      return res.status(400).json({ error:updateError.message || 'Delivery could not be completed.' });
    }
  }

  db.prepare(`UPDATE deliveries SET status='picked_up',picked_up_at=datetime('now') WHERE id=? AND status='assigned'`).run(delivery.id);
  return res.json({ ok:true });
});

export default router;
