import { db } from './db.js';
import { feedbackUrl } from './feedback-service.js';

export function getOrder(orderId) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) return null;
  const items = db.prepare('SELECT product_id AS productId, product_name AS name, unit_price_pesewas AS unitPricePesewas, quantity FROM order_items WHERE order_id=?').all(orderId);
  return { order, items };
}

export function settlePendingOrder(orderId, message = '') {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order) throw new Error('Sale not found.');
    if (order.status === 'paid') return order;
    if (order.status !== 'pending') throw new Error('This payment is no longer pending.');
    const items = db.prepare('SELECT * FROM order_items WHERE order_id=?').all(orderId);
    for (const item of items) {
      const inventory = db.prepare('SELECT * FROM branch_inventory WHERE branch_id=? AND product_id=?').get(order.branch_id,item.product_id);
      if (!inventory || inventory.on_hand < item.quantity || inventory.reserved < item.quantity) {
        throw new Error(`Stock reservation could not be confirmed for ${item.product_name}.`);
      }
    }
    for (const item of items) {
      db.prepare(`UPDATE branch_inventory SET on_hand=on_hand-?,reserved=reserved-?,updated_at=datetime('now') WHERE branch_id=? AND product_id=?`).run(item.quantity,item.quantity,order.branch_id,item.product_id);
      db.prepare(`INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by,branch_id)
        VALUES(?,?,?,'sale',?,?,?,?)`).run(item.product_id,item.product_name,-item.quantity,order.ref,order.cashier_name,order.customer_name,order.branch_id);
    }
    if (order.customer_phone) {
      const existing = db.prepare('SELECT id FROM customers WHERE phone=?').get(order.customer_phone);
      let customerId;
      if (existing) {
        customerId=existing.id;
        db.prepare(`UPDATE customers SET name=?,email=CASE WHEN ?!='' THEN ? ELSE email END,total_spent_pesewas=total_spent_pesewas+?,visits=visits+1,last_visit=datetime('now') WHERE id=?`).run(order.customer_name,order.customer_email||'',order.customer_email||'',order.total_pesewas,existing.id);
      } else {
        customerId=db.prepare(`INSERT INTO customers(name,phone,email,total_spent_pesewas,visits,last_visit) VALUES(?,?,?,?,1,datetime('now'))`).run(order.customer_name,order.customer_phone,order.customer_email||'',order.total_pesewas).lastInsertRowid;
      }
      db.prepare('UPDATE orders SET customer_id=? WHERE id=?').run(customerId,orderId);
    }
    db.prepare(`UPDATE orders SET status='paid',paid_at=datetime('now'),payment_message=? WHERE id=?`).run(message,orderId);
    return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  })();
}

export function failPendingOrder(orderId, message = 'Payment was not completed.') {
  return db.transaction(() => {
    const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
    if (!order || order.status !== 'pending') return order;
    const items = db.prepare('SELECT product_id,quantity FROM order_items WHERE order_id=?').all(orderId);
    for (const item of items) {
      db.prepare(`UPDATE branch_inventory SET reserved=MAX(0,reserved-?),updated_at=datetime('now') WHERE branch_id=? AND product_id=?`).run(item.quantity,order.branch_id,item.product_id);
    }
    db.prepare(`UPDATE orders SET status='failed',payment_message=? WHERE id=?`).run(message,orderId);
    return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  })();
}

// Call inside the delivery status transaction after the rider confirms cash collection.
export function recordCashOnDeliveryCollection(orderId, collectorId, collectorName) {
  const order = db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
  if (!order) throw new Error('Sale not found.');
  if (order.payment_method !== 'Cash on delivery') throw new Error('This order is not a cash-on-delivery order.');
  if (order.status === 'paid') return order;
  if (order.status !== 'due') throw new Error('This order is not awaiting cash collection.');

  if (order.customer_phone) {
    const existing = db.prepare('SELECT id FROM customers WHERE phone=?').get(order.customer_phone);
    if (existing) {
      db.prepare(`UPDATE customers SET name=?,email=CASE WHEN ?!='' THEN ? ELSE email END,total_spent_pesewas=total_spent_pesewas+?,visits=visits+1,last_visit=datetime('now') WHERE id=?`)
        .run(order.customer_name, order.customer_email||'', order.customer_email||'', order.total_pesewas, existing.id);
    } else {
      db.prepare(`INSERT INTO customers(name,phone,email,total_spent_pesewas,visits,last_visit) VALUES(?,?,?,?,1,datetime('now'))`)
        .run(order.customer_name, order.customer_phone, order.customer_email||'', order.total_pesewas);
    }
  }

  db.prepare(`UPDATE orders SET status='paid',paid_at=datetime('now'),cash_collected_by_id=?,cash_collected_by_name=? WHERE id=? AND status='due'`)
    .run(collectorId, collectorName, orderId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
}

export function publicOrder(order) {
  const branchName=order.branch_id?db.prepare('SELECT name FROM branches WHERE id=?').get(order.branch_id)?.name||'':'';
  return { id:order.id, ref:order.ref, total:order.total_pesewas/100, paymentMethod:order.payment_method,
    branchId:order.branch_id||null,branchName,
    customerName:order.customer_name, customerPhone:order.customer_phone, cashier:order.cashier_name,
    fulfillmentType:order.fulfillment_type||'pickup', deliveryAddress:order.delivery_address||'',
    deliveryInstructions:order.delivery_instructions||'', deliveryFee:(order.delivery_fee_pesewas||0)/100,
    cashCollectedBy:order.cash_collected_by_name||'', feedbackUrl:feedbackUrl(order.id),
    status:order.status, createdAt:order.created_at, paidAt:order.paid_at };
}
