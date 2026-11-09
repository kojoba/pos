import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { publicOrder } from '../order-service.js';
import { parseDeliveryDetails } from '../delivery-utils.js';
import { resolveBranchId } from '../branch-access.js';
const router=Router();
function mapOrder(o){return {...publicOrder(o),items:o.item_summary||''};}
router.get('/',requireAuth,requireRole('manager'),(req,res)=>{
 let branchId=req.auth.branchId||null;
 if(!branchId&&req.query.branchId){branchId=Number(req.query.branchId);if(!db.prepare('SELECT id FROM branches WHERE id=?').get(branchId))return res.status(400).json({error:'Choose a valid branch.'});}
 const where=branchId?'AND o.branch_id=?':'';
 const rows=db.prepare(`SELECT o.*, GROUP_CONCAT(oi.product_name || ' ×' || oi.quantity, ', ') AS item_summary
  FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.status IN ('paid','due') ${where} GROUP BY o.id ORDER BY o.id DESC LIMIT 500`).all(...(branchId?[branchId]:[]));
 res.json({orders:rows.map(mapOrder)});
});
router.post('/',requireAuth,requireRole('manager','worker'),(req,res)=>{
 let branchId;try{branchId=resolveBranchId(req.auth,req.body?.branchId)}catch(e){return res.status(400).json({error:e.message});}
 const lines=Array.isArray(req.body?.items)?req.body.items:[];
 const customerName=String(req.body?.customerName||'Walk-in customer').trim().slice(0,100);
 const customerPhone=String(req.body?.customerPhone||'').trim().slice(0,30);
 const method=String(req.body?.paymentMethod||'Cash');
 if(!['Cash','Cash on delivery'].includes(method))return res.status(400).json({error:'Use Paystack Mobile Money for electronic payments.'});
 let delivery;try{delivery=parseDeliveryDetails(req.body,customerPhone);}catch(e){return res.status(400).json({error:e.message});}
 const customerEmail=delivery.customerEmail;
 if(customerEmail&&!/^\S+@\S+\.\S+$/.test(customerEmail))return res.status(400).json({error:'Enter a valid customer email address.'});
 if(method==='Cash on delivery'&&delivery.fulfillmentType!=='delivery')return res.status(400).json({error:'Cash on delivery is available only for delivery orders.'});
 if(!lines.length||lines.length>100)return res.status(400).json({error:'Add at least one product to the cart.'});
 const quantities=new Map();
 for(const line of lines){const id=Number(line.productId),qty=Number(line.quantity);if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>1000)return res.status(400).json({error:'One or more cart quantities are invalid.'});quantities.set(id,(quantities.get(id)||0)+qty);}
 const transaction=db.transaction(()=>{
  let total=0;const details=[];
  for(const [id,qty] of quantities){const p=db.prepare(`SELECT p.*,bi.on_hand AS stock,bi.reserved FROM products p JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? WHERE p.id=? AND p.active=1`).get(branchId,id);if(!p)throw new Error('A product in your cart is not stocked at this branch.');const available=p.stock-p.reserved;if(available<qty)throw new Error(`Not enough stock for ${p.name} at this branch. Available: ${available}.`);total+=p.price_pesewas*qty;details.push({product:p,qty});}
  total+=delivery.deliveryFeePesewas;
  const ref=`DP-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
  const cashierName=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id).name;
  let customerId=null;
  const orderStatus=method==='Cash on delivery'?'due':'paid';
  if(customerPhone){const existing=db.prepare('SELECT id FROM customers WHERE phone=?').get(customerPhone);if(existing){customerId=existing.id;if(orderStatus==='paid')db.prepare(`UPDATE customers SET name=?,email=CASE WHEN ?!='' THEN ? ELSE email END,total_spent_pesewas=total_spent_pesewas+?,visits=visits+1,last_visit=datetime('now') WHERE id=?`).run(customerName,customerEmail,customerEmail,total,existing.id);else db.prepare(`UPDATE customers SET name=?,email=CASE WHEN ?!='' THEN ? ELSE email END WHERE id=?`).run(customerName,customerEmail,customerEmail,existing.id);}else if(orderStatus==='paid'){const created=db.prepare(`INSERT INTO customers(name,phone,email,total_spent_pesewas,visits,last_visit) VALUES(?,?,?,?,1,datetime('now'))`).run(customerName,customerPhone,customerEmail,total);customerId=created.lastInsertRowid;}else{const created=db.prepare(`INSERT INTO customers(name,phone,email,total_spent_pesewas,visits,last_visit) VALUES(?,?,?,0,0,NULL)`).run(customerName,customerPhone,customerEmail);customerId=created.lastInsertRowid;}}
  const created=db.prepare(`INSERT INTO orders(ref,total_pesewas,payment_method,customer_id,customer_name,customer_phone,customer_email,fulfillment_type,delivery_address,delivery_instructions,delivery_fee_pesewas,cashier_id,cashier_name,branch_id,status,paid_at)
   VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,CASE WHEN ?='paid' THEN datetime('now') ELSE NULL END)`).run(ref,total,method,customerId,customerName,customerPhone,delivery.customerEmail,delivery.fulfillmentType,delivery.deliveryAddress,delivery.deliveryInstructions,delivery.deliveryFeePesewas,req.auth.id,cashierName,branchId,orderStatus,orderStatus);
  for(const {product,qty} of details){db.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price_pesewas,quantity) VALUES(?,?,?,?,?)').run(created.lastInsertRowid,product.id,product.name,product.price_pesewas,qty);db.prepare('UPDATE branch_inventory SET on_hand=on_hand-?,updated_at=datetime(\'now\') WHERE branch_id=? AND product_id=?').run(qty,branchId,product.id);db.prepare(`INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by,branch_id) VALUES(?,?,?,'sale',?,?,?,?)`).run(product.id,product.name,-qty,ref,cashierName,customerName,branchId);}
  return db.prepare('SELECT * FROM orders WHERE id=?').get(created.lastInsertRowid);
 });
 try{const order=transaction();res.status(201).json({order:mapOrder(order)});}catch(error){res.status(400).json({error:error.message||'Sale could not be completed.'});}
});
router.get('/:id',requireAuth,requireRole('manager'),(req,res)=>{
 const order=db.prepare("SELECT * FROM orders WHERE id=? AND status IN ('paid','due') AND (? IS NULL OR branch_id=?)").get(Number(req.params.id),req.auth.branchId,req.auth.branchId);if(!order)return res.status(404).json({error:'Sale not found.'});
 const items=db.prepare('SELECT product_name AS name,unit_price_pesewas/100 AS price,quantity FROM order_items WHERE order_id=?').all(order.id);
 res.json({order:{...mapOrder(order),items}});
});
export default router;
