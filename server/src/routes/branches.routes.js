import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';

const router=Router();
const manager=[requireAuth,requireRole('manager')];

function branchMetrics(branch){
 const sales=db.prepare(`SELECT
  COALESCE(SUM(CASE WHEN status='paid' AND date(created_at)=date('now','localtime') THEN total_pesewas ELSE 0 END),0) AS today,
  COALESCE(SUM(CASE WHEN status='paid' AND date(created_at)>=date('now','localtime','-' || ((CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7) || ' days') THEN total_pesewas ELSE 0 END),0) AS week,
  COALESCE(SUM(CASE WHEN status='paid' AND strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime') THEN total_pesewas ELSE 0 END),0) AS month,
  COUNT(CASE WHEN status='paid' AND date(created_at)=date('now','localtime') THEN 1 END) AS todayOrders,
  COUNT(CASE WHEN status='due' THEN 1 END) AS cashDueOrders
  FROM orders WHERE branch_id=? AND status IN ('paid','due')`).get(branch.id);
 const activeDeliveries=db.prepare(`SELECT COUNT(*) AS count FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE o.branch_id=? AND d.status!='delivered'`).get(branch.id).count;
 const staffCount=db.prepare('SELECT COUNT(*) AS count FROM users WHERE branch_id=? AND active=1').get(branch.id).count;
 const stock=db.prepare(`SELECT COUNT(*) AS products,COALESCE(SUM(CASE WHEN bi.on_hand-bi.reserved<=p.reorder_level THEN 1 ELSE 0 END),0) AS lowStock,COALESCE(SUM(bi.on_hand),0) AS units FROM products p JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? WHERE p.active=1`).get(branch.id);
 return {...branch,active:Boolean(branch.active),today:sales.today/100,week:sales.week/100,month:sales.month/100,todayOrders:sales.todayOrders,cashDueOrders:sales.cashDueOrders,activeDeliveries,staffCount,productCount:stock.products,lowStock:stock.lowStock,stockUnits:stock.units};
}

router.get('/options',requireAuth,(req,res)=>{
 const rows=req.auth.role==='manager'&&!req.auth.branchId
  ?db.prepare('SELECT id,name,code FROM branches WHERE active=1 ORDER BY name').all()
  :db.prepare('SELECT id,name,code FROM branches WHERE id=? AND active=1').all(req.auth.branchId||0);
 res.json({branches:rows});
});
router.get('/',...manager,(req,res)=>{
 const rows=req.auth.branchId
  ?db.prepare('SELECT * FROM branches WHERE id=?').all(req.auth.branchId)
  :db.prepare('SELECT * FROM branches ORDER BY active DESC,name').all();
 res.json({branches:rows.map(branchMetrics),isHeadOffice:!req.auth.branchId});
});
router.post('/',...manager,(req,res)=>{
 if(req.auth.branchId)return res.status(403).json({error:'Only a head office manager can add branches.'});
 const name=String(req.body?.name||'').trim().slice(0,100),code=String(req.body?.code||'').trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20),address=String(req.body?.address||'').trim().slice(0,250),phone=String(req.body?.phone||'').trim().slice(0,30);
 if(!name||!code)return res.status(400).json({error:'Enter a branch name and short branch code.'});
 try{const result=db.transaction(()=>{const created=db.prepare('INSERT INTO branches(name,code,address,phone) VALUES(?,?,?,?)').run(name,code,address,phone);db.prepare('INSERT OR IGNORE INTO branch_inventory(branch_id,product_id,on_hand,reserved) SELECT ?,id,0,0 FROM products').run(created.lastInsertRowid);return created;})();return res.status(201).json({branch:branchMetrics(db.prepare('SELECT * FROM branches WHERE id=?').get(result.lastInsertRowid))});}
 catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'A branch already uses that name or code.'});throw error;}
});
router.patch('/:id',...manager,(req,res)=>{
 if(req.auth.branchId)return res.status(403).json({error:'Only a head office manager can edit branches.'});
 const id=Number(req.params.id),old=db.prepare('SELECT * FROM branches WHERE id=?').get(id);if(!old)return res.status(404).json({error:'Branch not found.'});
 const name=String(req.body?.name??old.name).trim().slice(0,100),code=String(req.body?.code??old.code).trim().toUpperCase().replace(/[^A-Z0-9_-]/g,'').slice(0,20),address=String(req.body?.address??old.address).trim().slice(0,250),phone=String(req.body?.phone??old.phone).trim().slice(0,30),active=req.body?.active===undefined?old.active:(req.body.active?1:0);
 if(!name||!code)return res.status(400).json({error:'Enter a branch name and short branch code.'});
 if(old.code==='MAIN'&&code!=='MAIN')return res.status(400).json({error:'The Main Branch code is reserved for legacy data and cannot be changed.'});
 if(!active&&id===db.prepare("SELECT id FROM branches WHERE code='MAIN'").get()?.id)return res.status(400).json({error:'The original main branch cannot be deactivated.'});
 try{db.prepare('UPDATE branches SET name=?,code=?,address=?,phone=?,active=? WHERE id=?').run(name,code,address,phone,active,id);return res.json({branch:branchMetrics(db.prepare('SELECT * FROM branches WHERE id=?').get(id))});}
 catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'A branch already uses that name or code.'});throw error;}
});
export default router;
