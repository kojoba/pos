import { db } from './db.js';

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
      const product = db.prepare('SELECT * FROM products WHERE id=?').get(item.product_id);
      if (!product || product.stock < item.quantity || product.reserved < item.quantity) {
        throw new Error(`Stock reservation could not be confirmed for ${item.product_name}.`);
      }
    }
    for (const item of items) {
      db.prepare('UPDATE products SET stock=stock-?, reserved=reserved-? WHERE id=?').run(item.quantity,item.quantity,item.product_id);
      db.prepare(`INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by)
        VALUES(?,?,?,'sale',?,?,?)`).run(item.product_id,item.product_name,-item.quantity,order.ref,order.cashier_name,order.customer_name);
    }
    if (order.customer_phone) {
      const existing = db.prepare('SELECT id FROM customers WHERE phone=?').get(order.customer_phone);
      if (existing) db.prepare(`UPDATE customers SET name=?,total_spent_pesewas=total_spent_pesewas+?,visits=visits+1,last_visit=datetime('now') WHERE id=?`).run(order.customer_name,order.total_pesewas,existing.id);
      else db.prepare(`INSERT INTO customers(name,phone,total_spent_pesewas,visits,last_visit) VALUES(?,?,?,1,datetime('now'))`).run(order.customer_name,order.customer_phone,order.total_pesewas);
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
      db.prepare('UPDATE products SET reserved=MAX(0,reserved-?) WHERE id=?').run(item.quantity,item.product_id);
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
      db.prepare(`UPDATE customers SET name=?,total_spent_pesewas=total_spent_pesewas+?,visits=visits+1,last_visit=datetime('now') WHERE id=?`)
        .run(order.customer_name, order.total_pesewas, existing.id);
    } else {
      db.prepare(`INSERT INTO customers(name,phone,total_spent_pesewas,visits,last_visit) VALUES(?,?,?,1,datetime('now'))`)
        .run(order.customer_name, order.customer_phone, order.total_pesewas);
    }
  }

  db.prepare(`UPDATE orders SET status='paid',paid_at=datetime('now'),cash_collected_by_id=?,cash_collected_by_name=? WHERE id=? AND status='due'`)
    .run(collectorId, collectorName, orderId);
  return db.prepare('SELECT * FROM orders WHERE id=?').get(orderId);
}

export function publicOrder(order) {
  return { id:order.id, ref:order.ref, total:order.total_pesewas/100, paymentMethod:order.payment_method,
    customerName:order.customer_name, customerPhone:order.customer_phone, cashier:order.cashier_name,
    fulfillmentType:order.fulfillment_type||'pickup', deliveryAddress:order.delivery_address||'',
    deliveryInstructions:order.delivery_instructions||'', deliveryFee:(order.delivery_fee_pesewas||0)/100,
    cashCollectedBy:order.cash_collected_by_name||'',
    status:order.status, createdAt:order.created_at, paidAt:order.paid_at };
}
