import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { resolveBranchId } from '../branch-access.js';
const router=Router();
const map=p=>({id:p.id,name:p.name,category:p.category,price:p.price_pesewas/100,stock:p.stock-p.reserved,onHand:p.stock,reserved:p.reserved,reorderLevel:p.reorder_level,active:Boolean(p.active),branchId:p.branch_id,branchName:p.branch_name||''});
function selectedBranch(req){
 if(req.auth.branchId)return req.auth.branchId;
 const fallback=db.prepare(`SELECT id FROM branches WHERE code='MAIN' AND active=1`).get()?.id;
 return resolveBranchId(req.auth,req.query.branchId||req.body?.branchId||fallback);
}
router.get('/',requireAuth,(req,res)=>{
 let branchId;try{branchId=selectedBranch(req)}catch(e){return res.status(400).json({error:e.message})}
 const products=db.prepare(`SELECT p.*,bi.on_hand AS stock,bi.reserved,bi.branch_id,b.name AS branch_name FROM products p
  JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? JOIN branches b ON b.id=bi.branch_id
  WHERE p.active=1 ORDER BY p.name`).all(branchId);
 res.json({branchId,branchName:products[0]?.branch_name||db.prepare('SELECT name FROM branches WHERE id=?').get(branchId)?.name||'',products:products.map(map)});
});
router.post('/',requireAuth,requireRole('manager'),(req,res)=>{
 if(req.auth.branchId)return res.status(403).json({error:'Only a head office manager can change the shared menu catalog.'});
 const name=String(req.body?.name||'').trim(),category=String(req.body?.category||'Food').trim();
 const price=Number(req.body?.price),stock=Number(req.body?.stock??0),reorder=Number(req.body?.reorderLevel??10);
 let branchId;try{branchId=selectedBranch(req)}catch(e){return res.status(400).json({error:e.message})}
 if(!name||!Number.isFinite(price)||price<0||!Number.isInteger(stock)||stock<0||!Number.isInteger(reorder)||reorder<0)return res.status(400).json({error:'Enter a product name, valid price, stock and reorder level.'});
 const actor=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id).name;
 const tx=db.transaction(()=>{
  const result=db.prepare('INSERT INTO products(name,category,price_pesewas,stock,reserved,reorder_level) VALUES(?,?,?,?,0,?)').run(name,category,Math.round(price*100),stock,reorder);
  db.prepare(`INSERT INTO branch_inventory(branch_id,product_id,on_hand,reserved) SELECT id,?,?,0 FROM branches WHERE id!=?`).run(result.lastInsertRowid,0,branchId);
  db.prepare(`INSERT INTO branch_inventory(branch_id,product_id,on_hand,reserved) VALUES(?,?,?,0)`).run(branchId,result.lastInsertRowid,stock);
  db.prepare('INSERT OR IGNORE INTO warehouse_inventory(product_id,quantity) VALUES(?,0)').run(result.lastInsertRowid);
  if(stock)db.prepare('INSERT INTO stock_movements(product_id,product_name,quantity,movement_type,performed_by,branch_id) VALUES(?,?,?,?,?,?)').run(result.lastInsertRowid,name,stock,'opening_stock',actor,branchId);
  return result.lastInsertRowid;
 });
 const id=tx();res.status(201).json({product:map(db.prepare(`SELECT p.*,bi.on_hand AS stock,bi.reserved,bi.branch_id,b.name AS branch_name FROM products p JOIN branch_inventory bi ON bi.product_id=p.id JOIN branches b ON b.id=bi.branch_id WHERE p.id=? AND bi.branch_id=?`).get(id,branchId))});
});
router.patch('/:id',requireAuth,requireRole('manager'),(req,res)=>{
 if(req.auth.branchId)return res.status(403).json({error:'Only a head office manager can change the shared menu catalog.'});
 const id=Number(req.params.id),old=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);if(!old)return res.status(404).json({error:'Product not found.'});
 const name=String(req.body?.name??old.name).trim(),category=String(req.body?.category??old.category).trim(),price=Number(req.body?.price??old.price_pesewas/100),reorder=Number(req.body?.reorderLevel??old.reorder_level);
 if(!name||!Number.isFinite(price)||price<0||!Number.isInteger(reorder)||reorder<0)return res.status(400).json({error:'Enter valid product details.'});
 db.prepare('UPDATE products SET name=?,category=?,price_pesewas=?,reorder_level=? WHERE id=?').run(name,category,Math.round(price*100),reorder,id);
 let branchId;try{branchId=selectedBranch(req)}catch{branchId=db.prepare(`SELECT id FROM branches WHERE code='MAIN'`).get().id}
 const product=db.prepare(`SELECT p.*,bi.on_hand AS stock,bi.reserved,bi.branch_id,b.name AS branch_name FROM products p JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? JOIN branches b ON b.id=bi.branch_id WHERE p.id=?`).get(branchId,id);
 res.json({product:map(product)});
});
router.delete('/:id',requireAuth,requireRole('manager'),(req,res)=>{
 if(req.auth.branchId)return res.status(403).json({error:'Only a head office manager can change the shared menu catalog.'});
 const result=db.prepare('UPDATE products SET active=0 WHERE id=? AND active=1').run(Number(req.params.id));if(!result.changes)return res.status(404).json({error:'Product not found.'});res.json({ok:true});
});
export default router;
