import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router=Router();
router.get('/movements',requireAuth,requireRole('manager'),(_req,res)=>{
 const movements=db.prepare('SELECT * FROM stock_movements ORDER BY id DESC LIMIT 250').all().map(m=>({...m,quantity:m.quantity,createdAt:m.created_at}));
 res.json({movements});
});
router.post('/adjustments',requireAuth,requireRole('manager'),(req,res)=>{
 const id=Number(req.body?.productId), delta=Number(req.body?.quantity), note=String(req.body?.note||'Adjustment').trim().slice(0,100);
 if(!Number.isInteger(id)||!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000)return res.status(400).json({error:'Enter a non-zero whole-number stock adjustment.'});
 const tx=db.transaction(()=>{const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);if(!p)throw new Error('Product not found.');if(p.stock+delta<p.reserved)throw new Error(`Adjustment cannot reduce physical stock below the ${p.reserved} units currently reserved for pending mobile money payments.`);db.prepare('UPDATE products SET stock=stock+? WHERE id=?').run(delta,id);db.prepare('INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by) VALUES(?,?,?,?,?,?,?)').run(id,p.name,delta,'adjustment',note,db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id).name,'');});
 try{tx();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
router.get('/requests',requireAuth,requireRole('manager','worker'),(req,res)=>{
 const isManager=req.auth.role==='manager';
 const rows=isManager?db.prepare('SELECT * FROM stock_requests ORDER BY CASE status WHEN \'pending\' THEN 0 ELSE 1 END, id DESC').all():db.prepare('SELECT * FROM stock_requests WHERE requested_by_id=? ORDER BY id DESC').all(req.auth.id);
 res.json({requests:rows.map(r=>({id:r.id,productId:r.product_id,productName:r.product_name,quantity:r.quantity,requestedBy:r.requested_by_name,receivedBy:r.received_by,note:r.note,status:r.status,reviewedBy:r.reviewed_by,createdAt:r.created_at,reviewedAt:r.reviewed_at}))});
});
router.post('/requests',requireAuth,requireRole('worker'),(req,res)=>{
 const id=Number(req.body?.productId),qty=Number(req.body?.quantity),receiver=String(req.body?.receivedBy||'').trim().slice(0,100),note=String(req.body?.note||'').trim().slice(0,200);
 if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>10000||!receiver)return res.status(400).json({error:'Choose a product, quantity and receiver.'});
 const product=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);if(!product)return res.status(404).json({error:'Product not found.'});
 const user=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 db.prepare('INSERT INTO stock_requests(product_id,product_name,quantity,requested_by_id,requested_by_name,received_by,note) VALUES(?,?,?,?,?,?,?)').run(id,product.name,qty,req.auth.id,user.name,receiver,note);
 res.status(201).json({ok:true,message:'Request sent to a manager for approval.'});
});
router.patch('/requests/:id',requireAuth,requireRole('manager'),(req,res)=>{
 const status=String(req.body?.status||'');if(!['approved','rejected'].includes(status))return res.status(400).json({error:'Choose approve or reject.'});
 const user=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 const tx=db.transaction(()=>{const r=db.prepare('SELECT * FROM stock_requests WHERE id=?').get(Number(req.params.id));if(!r)throw new Error('Request not found.');if(r.status!=='pending')throw new Error('This request has already been reviewed.');
  if(status==='approved'){const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(r.product_id);if(!p||p.stock-p.reserved<r.quantity)throw new Error(`Not enough available stock to approve this request. Available: ${p?Math.max(0,p.stock-p.reserved):0}.`);db.prepare('UPDATE products SET stock=stock-? WHERE id=?').run(r.quantity,r.product_id);db.prepare('INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by) VALUES(?,?,?,?,?,?,?)').run(r.product_id,r.product_name,-r.quantity,'stock_issue',`REQ-${r.id}`,user.name,r.received_by);}
  db.prepare('UPDATE stock_requests SET status=?,reviewed_by=?,reviewed_at=datetime(\'now\') WHERE id=?').run(status,user.name,r.id);
 });
 try{tx();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
export default router;
