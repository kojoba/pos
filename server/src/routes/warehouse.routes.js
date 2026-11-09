import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { resolveBranchId } from '../branch-access.js';

const router = Router();
const staffRoles = ['manager', 'worker'];

function actorFor(id) {
  return db.prepare('SELECT id,name,role FROM users WHERE id=? AND active=1').get(id);
}

function insertMovement({ productId, productName, quantity, type, reference, performedBy, receivedBy = '', location, branchId = null }) {
  db.prepare(`INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by,location,branch_id)
    VALUES(?,?,?,?,?,?,?,?,?)`).run(productId,productName,quantity,type,reference,performedBy,receivedBy,location,branchId);
}

router.get('/', requireAuth, requireRole(...staffRoles), (req, res) => {
  const mainBranch=db.prepare(`SELECT id FROM branches WHERE code='MAIN' AND active=1`).get()?.id;
  let branchId;try{branchId=resolveBranchId(req.auth,req.auth.branchId||req.query.branchId||mainBranch)}catch(error){return res.status(400).json({error:error.message});}
  const products = db.prepare(`SELECT p.id,p.name,p.category,bi.on_hand AS restaurantStock,bi.reserved,
      COALESCE(w.quantity,0) AS warehouseStock,
      COALESCE((SELECT SUM(wr.quantity) FROM warehouse_requests wr WHERE wr.product_id=p.id AND wr.status='approved'),0) AS warehouseReserved
    FROM products p JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? LEFT JOIN warehouse_inventory w ON w.product_id=p.id
    WHERE p.active=1 ORDER BY p.name`).all(branchId).map(p => ({
      id:p.id,name:p.name,category:p.category,restaurantStock:p.restaurantStock,
      warehouseStock:p.warehouseStock,warehouseReserved:p.warehouseReserved,
      warehouseAvailable:Math.max(0,p.warehouseStock-p.warehouseReserved),
    }));
  const recipients = db.prepare(`SELECT id,name,role,branch_id AS branchId FROM users WHERE active=1 AND role IN ('manager','worker') AND branch_id=? ORDER BY name`).all(branchId);
  const branchName=db.prepare('SELECT name FROM branches WHERE id=?').get(branchId)?.name||'';
  res.json({ branchId,branchName,products, recipients });
});

router.get('/requests', requireAuth, requireRole(...staffRoles), (req, res) => {
  const rows = req.auth.role === 'manager'
    ? db.prepare(`SELECT * FROM warehouse_requests WHERE (? IS NULL OR branch_id=?) ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'approved' THEN 1 WHEN 'dispatched' THEN 2 ELSE 3 END,id DESC`).all(req.auth.branchId,req.auth.branchId)
    : db.prepare(`SELECT * FROM warehouse_requests WHERE branch_id=? AND (requested_by_id=? OR recipient_id=?) ORDER BY id DESC`).all(req.auth.branchId||0,req.auth.id,req.auth.id);
  res.json({ requests:rows.map(r => ({
    id:r.id,reference:r.reference,branchId:r.branch_id,productId:r.product_id,productName:r.product_name,quantity:r.quantity,
    requestedById:r.requested_by_id,requestedBy:r.requested_by_name,
    recipientId:r.recipient_id,recipient:r.recipient_name,note:r.note||'',status:r.status,
    approvedBy:r.approved_by_name||'',approvedAt:r.approved_at,
    dispatchedBy:r.dispatched_by_name||'',dispatchedAt:r.dispatched_at,
    receivedQuantity:r.received_quantity,receivedBy:r.received_by_name||'',
    receivedConfirmedBy:r.received_confirmed_by_name||'',receivedAt:r.received_at,
    receiveNote:r.receive_note||'',rejectedBy:r.rejected_by_name||'',rejectedAt:r.rejected_at,
    createdAt:r.created_at,
  })) });
});

router.post('/requests', requireAuth, requireRole(...staffRoles), (req, res) => {
  const productId = Number(req.body?.productId), quantity = Number(req.body?.quantity);
  const recipientId = Number(req.body?.recipientId || req.auth.id);
  const note = String(req.body?.note||'').trim().slice(0,300);
  if (!Number.isInteger(productId)||!Number.isInteger(quantity)||quantity<1||quantity>10000) {
    return res.status(400).json({ error:'Choose a product and enter a whole-number quantity greater than zero.' });
  }
  const product = db.prepare('SELECT id,name FROM products WHERE id=? AND active=1').get(productId);
  const recipient = db.prepare(`SELECT id,name,branch_id FROM users WHERE id=? AND active=1 AND role IN ('manager','worker')`).get(recipientId);
  const requester = actorFor(req.auth.id);
  if (!product) return res.status(404).json({ error:'Product not found.' });
  if (!recipient) return res.status(400).json({ error:'Choose an active manager or worker to receive the stock.' });
  let branchId;try{branchId=resolveBranchId(req.auth,req.body?.branchId||recipient.branch_id)}catch(error){return res.status(400).json({error:error.message});}
  if(recipient.branch_id!==branchId)return res.status(400).json({error:'Choose a recipient assigned to the destination branch.'});
  const reference = `WR-${new Date().toISOString().slice(0,10).replaceAll('-','')}-${randomUUID().slice(0,6).toUpperCase()}`;
  const result = db.prepare(`INSERT INTO warehouse_requests(reference,product_id,product_name,quantity,requested_by_id,requested_by_name,recipient_id,recipient_name,branch_id,note)
    VALUES(?,?,?,?,?,?,?,?,?,?)`).run(reference,product.id,product.name,quantity,requester.id,requester.name,recipient.id,recipient.name,branchId,note);
  res.status(201).json({ ok:true,id:result.lastInsertRowid,reference });
});

router.post('/adjustments', requireAuth, requireRole('manager'), (req, res) => {
  if(req.auth.branchId)return res.status(403).json({error:'Only a head office manager can adjust the central warehouse balance.'});
  const productId = Number(req.body?.productId), delta = Number(req.body?.quantity);
  const note = String(req.body?.note||'').trim().slice(0,200);
  if (!Number.isInteger(productId)||!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000||!note) {
    return res.status(400).json({ error:'Choose a product, enter a non-zero whole-number quantity and provide a reason.' });
  }
  const actor = actorFor(req.auth.id);
  const tx = db.transaction(() => {
    const product = db.prepare('SELECT id,name FROM products WHERE id=?').get(productId);
    if (!product) throw new Error('Product not found.');
    const current = db.prepare('SELECT quantity FROM warehouse_inventory WHERE product_id=?').get(productId)?.quantity||0;
    const reserved = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity FROM warehouse_requests WHERE product_id=? AND status='approved'`).get(productId).quantity;
    if (current+delta<reserved) throw new Error(`Warehouse stock cannot be reduced below ${reserved} units already approved for transfer.`);
    if (current+delta<0) throw new Error('Warehouse stock cannot be negative.');
    db.prepare(`INSERT INTO warehouse_inventory(product_id,quantity,updated_at) VALUES(?,?,datetime('now'))
      ON CONFLICT(product_id) DO UPDATE SET quantity=excluded.quantity,updated_at=datetime('now')`).run(productId,current+delta);
    insertMovement({productId,productName:product.name,quantity:delta,type:'warehouse_adjustment',reference:note,performedBy:actor.name,location:'warehouse'});
  });
  try { tx.immediate(); return res.json({ ok:true }); }
  catch (error) { return res.status(400).json({ error:error.message||'Warehouse adjustment could not be saved.' }); }
});

router.patch('/requests/:id/review', requireAuth, requireRole('manager'), (req, res) => {
  const decision = String(req.body?.decision||'');
  if (!['approved','rejected'].includes(decision)) return res.status(400).json({ error:'Choose approve or reject.' });
  const actor = actorFor(req.auth.id);
  const tx = db.transaction(() => {
    const request = db.prepare('SELECT * FROM warehouse_requests WHERE id=?').get(Number(req.params.id));
    if (!request) throw new Error('Warehouse request not found.');
    if(req.auth.branchId&&request.branch_id!==req.auth.branchId)throw new Error('This request belongs to another branch.');
    if (request.status!=='pending') throw new Error('This request has already been reviewed.');
    if (decision==='approved') {
      const stock = db.prepare('SELECT quantity FROM warehouse_inventory WHERE product_id=?').get(request.product_id)?.quantity||0;
      const reserved = db.prepare(`SELECT COALESCE(SUM(quantity),0) AS quantity FROM warehouse_requests WHERE product_id=? AND status='approved'`).get(request.product_id).quantity;
      if (stock-reserved<request.quantity) throw new Error(`Not enough unallocated warehouse stock. Available to approve: ${Math.max(0,stock-reserved)}.`);
      db.prepare(`UPDATE warehouse_requests SET status='approved',approved_by_id=?,approved_by_name=?,approved_at=datetime('now') WHERE id=?`).run(actor.id,actor.name,request.id);
    } else {
      db.prepare(`UPDATE warehouse_requests SET status='rejected',rejected_by_id=?,rejected_by_name=?,rejected_at=datetime('now') WHERE id=?`).run(actor.id,actor.name,request.id);
    }
  });
  try { tx.immediate(); return res.json({ ok:true }); }
  catch (error) { return res.status(400).json({ error:error.message||'The request could not be reviewed.' }); }
});

router.post('/requests/:id/dispatch', requireAuth, requireRole('manager'), (req, res) => {
  const actor = actorFor(req.auth.id);
  const tx = db.transaction(() => {
    const request = db.prepare('SELECT * FROM warehouse_requests WHERE id=?').get(Number(req.params.id));
    if (!request) throw new Error('Warehouse request not found.');
    if(req.auth.branchId&&request.branch_id!==req.auth.branchId)throw new Error('This request belongs to another branch.');
    if (request.status!=='approved') throw new Error('Only an approved request can be dispatched.');
    const inventory = db.prepare('SELECT quantity FROM warehouse_inventory WHERE product_id=?').get(request.product_id);
    if (!inventory || inventory.quantity<request.quantity) throw new Error('Warehouse stock is no longer sufficient to dispatch this request.');
    db.prepare(`UPDATE warehouse_inventory SET quantity=quantity-?,updated_at=datetime('now') WHERE product_id=?`).run(request.quantity,request.product_id);
    db.prepare(`UPDATE warehouse_requests SET status='dispatched',dispatched_by_id=?,dispatched_by_name=?,dispatched_at=datetime('now') WHERE id=?`).run(actor.id,actor.name,request.id);
    insertMovement({productId:request.product_id,productName:request.product_name,quantity:-request.quantity,type:'warehouse_dispatch',reference:request.reference,performedBy:actor.name,receivedBy:request.recipient_name,location:'warehouse',branchId:request.branch_id});
  });
  try { tx.immediate(); return res.json({ ok:true }); }
  catch (error) { return res.status(400).json({ error:error.message||'Items could not be dispatched.' }); }
});

router.post('/requests/:id/receive', requireAuth, requireRole(...staffRoles), (req, res) => {
  const receivedQuantity = Number(req.body?.receivedQuantity);
  const note = String(req.body?.note||'').trim().slice(0,300);
  if (!Number.isInteger(receivedQuantity)||receivedQuantity<0) return res.status(400).json({ error:'Enter the whole-number quantity received.' });
  const actor = actorFor(req.auth.id);
  const tx = db.transaction(() => {
    const request = db.prepare('SELECT * FROM warehouse_requests WHERE id=?').get(Number(req.params.id));
    if (!request) throw new Error('Warehouse request not found.');
    if(req.auth.branchId&&request.branch_id!==req.auth.branchId)throw new Error('This request belongs to another branch.');
    if (request.status!=='dispatched') throw new Error('Only dispatched items can be received.');
    if (req.auth.role!=='manager'&&request.recipient_id!==req.auth.id) throw new Error('Only the assigned recipient can confirm this delivery.');
    if (receivedQuantity>request.quantity) throw new Error(`You can receive no more than ${request.quantity} units.`);
    if (receivedQuantity<request.quantity&&!note) throw new Error('Add a note describing the missing or damaged quantity.');
    if (receivedQuantity>0) {
      db.prepare(`UPDATE branch_inventory SET on_hand=on_hand+?,updated_at=datetime('now') WHERE branch_id=? AND product_id=?`).run(receivedQuantity,request.branch_id,request.product_id);
      insertMovement({productId:request.product_id,productName:request.product_name,quantity:receivedQuantity,type:'warehouse_receipt',reference:request.reference,performedBy:actor.name,receivedBy:request.recipient_name,location:'restaurant',branchId:request.branch_id});
    }
    const shortage=request.quantity-receivedQuantity;
    if (shortage>0) insertMovement({productId:request.product_id,productName:request.product_name,quantity:-shortage,type:'transfer_shortage',reference:`${request.reference} · ${note}`.slice(0,100),performedBy:actor.name,receivedBy:request.recipient_name,location:'in_transit',branchId:request.branch_id});
    db.prepare(`UPDATE warehouse_requests SET status='received',received_quantity=?,received_by_id=?,received_by_name=?,received_confirmed_by_id=?,received_confirmed_by_name=?,received_at=datetime('now'),receive_note=? WHERE id=?`)
      .run(receivedQuantity,request.recipient_id,request.recipient_name,actor.id,actor.name,note,request.id);
  });
  try { tx.immediate(); return res.json({ ok:true }); }
  catch (error) { return res.status(400).json({ error:error.message||'Receipt could not be recorded.' }); }
});

export default router;
