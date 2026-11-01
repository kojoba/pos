import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router = Router();
const map = p => ({ id:p.id, name:p.name, category:p.category, price:p.price_pesewas/100, stock:p.stock-p.reserved, onHand:p.stock, reserved:p.reserved, reorderLevel:p.reorder_level, active:Boolean(p.active) });
router.get('/', requireAuth, (_req,res) => res.json({ products: db.prepare('SELECT * FROM products WHERE active = 1 ORDER BY name').all().map(map) }));
router.post('/', requireAuth, requireRole('manager'), (req,res) => {
  const name=String(req.body?.name||'').trim(), category=String(req.body?.category||'Food').trim();
  const price=Number(req.body?.price), stock=Number(req.body?.stock ?? 0), reorder=Number(req.body?.reorderLevel ?? 10);
  if(!name || !Number.isFinite(price) || price<0 || !Number.isInteger(stock) || stock<0 || !Number.isInteger(reorder) || reorder<0) return res.status(400).json({error:'Enter a product name, valid price, stock and reorder level.'});
  const result=db.prepare('INSERT INTO products (name,category,price_pesewas,stock,reorder_level) VALUES (?,?,?,?,?)').run(name,category,Math.round(price*100),stock,reorder);
  if(stock) db.prepare('INSERT INTO stock_movements (product_id,product_name,quantity,movement_type,performed_by) VALUES (?,?,?,?,?)').run(result.lastInsertRowid,name,stock,'opening_stock',db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id).name);
  res.status(201).json({product:map(db.prepare('SELECT * FROM products WHERE id=?').get(result.lastInsertRowid))});
});
router.patch('/:id', requireAuth, requireRole('manager'), (req,res) => {
  const id=Number(req.params.id), old=db.prepare('SELECT * FROM products WHERE id=? AND active=1').get(id);
  if(!old)return res.status(404).json({error:'Product not found.'});
  const name=String(req.body?.name ?? old.name).trim(), category=String(req.body?.category ?? old.category).trim();
  const price=Number(req.body?.price ?? old.price_pesewas/100), reorder=Number(req.body?.reorderLevel ?? old.reorder_level);
  if(!name || !Number.isFinite(price) || price<0 || !Number.isInteger(reorder) || reorder<0)return res.status(400).json({error:'Enter valid product details.'});
  db.prepare('UPDATE products SET name=?,category=?,price_pesewas=?,reorder_level=? WHERE id=?').run(name,category,Math.round(price*100),reorder,id);
  res.json({product:map(db.prepare('SELECT * FROM products WHERE id=?').get(id))});
});
router.delete('/:id', requireAuth, requireRole('manager'), (req,res) => {
  const result=db.prepare('UPDATE products SET active=0 WHERE id=? AND active=1').run(Number(req.params.id));
  if(!result.changes)return res.status(404).json({error:'Product not found.'});
  res.json({ok:true});
});
export default router;
