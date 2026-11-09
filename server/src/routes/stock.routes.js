import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { resolveBranchId } from '../branch-access.js';
const router=Router();
router.get('/movements',requireAuth,requireRole('manager'),(req,res)=>{
 const movements=db.prepare('SELECT m.*,b.name AS branch_name FROM stock_movements m LEFT JOIN branches b ON b.id=m.branch_id WHERE (? IS NULL OR m.branch_id=?) ORDER BY m.id DESC LIMIT 250').all(req.auth.branchId,req.auth.branchId).map(m=>({...m,quantity:m.quantity,createdAt:m.created_at,location:m.location||'restaurant',branchName:m.branch_name||'Head office / central'}));
 res.json({movements});
});
router.post('/adjustments',requireAuth,requireRole('manager'),(req,res)=>{
 const id=Number(req.body?.productId), delta=Number(req.body?.quantity), note=String(req.body?.note||'Adjustment').trim().slice(0,100);
 const mainBranch=db.prepare(`SELECT id FROM branches WHERE code='MAIN' AND active=1`).get()?.id;
 let branchId;try{branchId=resolveBranchId(req.auth,req.body?.branchId||req.auth.branchId||mainBranch)}catch(e){return res.status(400).json({error:e.message});}
 if(!Number.isInteger(id)||!Number.isInteger(delta)||delta===0||Math.abs(delta)>100000)return res.status(400).json({error:'Enter a non-zero whole-number stock adjustment.'});
 const tx=db.transaction(()=>{const p=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);if(!p)throw new Error('Product not found.');const inventory=db.prepare('SELECT on_hand,reserved FROM branch_inventory WHERE branch_id=? AND product_id=?').get(branchId,id);if(!inventory)throw new Error('This product has no stock record at the selected branch.');if(inventory.on_hand+delta<inventory.reserved)throw new Error(`Adjustment cannot reduce stock below the ${inventory.reserved} units currently reserved for pending mobile money payments.`);if(inventory.on_hand+delta<0)throw new Error('Branch stock cannot be negative.');db.prepare(`UPDATE branch_inventory SET on_hand=on_hand+?,updated_at=datetime('now') WHERE branch_id=? AND product_id=?`).run(delta,branchId,id);db.prepare('INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,reference,performed_by,received_by,location,branch_id) VALUES(?,?,?,?,?,?,?,?,?)').run(id,p.name,delta,'adjustment',note,db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id).name,'','restaurant',branchId);});
 try{tx();res.json({ok:true});}catch(e){res.status(400).json({error:e.message});}
});
router.get('/requests',requireAuth,requireRole('manager','worker'),(req,res)=>{
 const isManager=req.auth.role==='manager';
 const rows=isManager&&!req.auth.branchId?db.prepare(`SELECT * FROM stock_requests WHERE status!='pending' ORDER BY id DESC`).all():isManager?db.prepare(`SELECT s.* FROM stock_requests s JOIN users u ON u.id=s.requested_by_id WHERE u.branch_id=? AND s.status!='pending' ORDER BY s.id DESC`).all(req.auth.branchId):db.prepare(`SELECT * FROM stock_requests WHERE requested_by_id=? AND status!='pending' ORDER BY id DESC`).all(req.auth.id);
 res.json({requests:rows.map(r=>({id:r.id,productId:r.product_id,productName:r.product_name,quantity:r.quantity,requestedBy:r.requested_by_name,receivedBy:r.received_by,note:r.note,status:r.status,reviewedBy:r.reviewed_by,createdAt:r.created_at,reviewedAt:r.reviewed_at}))});
});
router.post('/requests',requireAuth,requireRole('manager','worker'),(_req,res)=>res.status(410).json({error:'Stock requests now use the warehouse transfer workflow.'}));
router.patch('/requests/:id',requireAuth,requireRole('manager'),(_req,res)=>res.status(410).json({error:'Use the warehouse transfer workflow to review this request.'}));
export default router;
