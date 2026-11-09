import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router=Router();
router.get('/',requireAuth,requireRole('manager'),(req,res)=>{
 const branchId=req.auth.branchId||null, filter=branchId?'AND branch_id=?':'';
 const params=branchId?[branchId]:[];
 const sales=db.prepare(`SELECT
  COALESCE(SUM(CASE WHEN date(created_at)=date('now','localtime') THEN total_pesewas ELSE 0 END),0) AS today,
  COALESCE(SUM(CASE WHEN date(created_at)>=date('now','localtime','-' || ((CAST(strftime('%w','now','localtime') AS INTEGER)+6)%7) || ' days') THEN total_pesewas ELSE 0 END),0) AS week,
  COALESCE(SUM(CASE WHEN strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime') THEN total_pesewas ELSE 0 END),0) AS month,
  COUNT(CASE WHEN date(created_at)=date('now','localtime') THEN 1 END) AS today_count
  FROM orders WHERE status='paid' ${filter}`).get(...params);
 const products=branchId
  ?db.prepare(`SELECT COUNT(*) AS count,SUM(CASE WHEN bi.on_hand-bi.reserved<=p.reorder_level THEN 1 ELSE 0 END) AS low FROM products p JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? WHERE p.active=1`).get(branchId)
  :db.prepare(`SELECT (SELECT COUNT(*) FROM products WHERE active=1) AS count,SUM(CASE WHEN bi.on_hand-bi.reserved<=p.reorder_level THEN 1 ELSE 0 END) AS low FROM products p JOIN branch_inventory bi ON bi.product_id=p.id JOIN branches b ON b.id=bi.branch_id AND b.active=1 WHERE p.active=1`).get();
 const customerCount=branchId
  ?db.prepare('SELECT COUNT(DISTINCT customer_id) AS count FROM orders WHERE branch_id=? AND customer_id IS NOT NULL').get(branchId).count
  :db.prepare('SELECT COUNT(*) AS count FROM customers').get().count;
 const recent=db.prepare(`SELECT o.*,b.name AS branch_name,GROUP_CONCAT(oi.product_name || ' ×' || oi.quantity, ', ') AS item_summary FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id LEFT JOIN branches b ON b.id=o.branch_id WHERE o.status='paid' ${filter.replaceAll('branch_id','o.branch_id')} GROUP BY o.id ORDER BY o.id DESC LIMIT 8`).all(...params).map(o=>({id:o.id,ref:o.ref,total:o.total_pesewas/100,paymentMethod:o.payment_method,customerName:o.customer_name,cashier:o.cashier_name,createdAt:o.created_at,items:o.item_summary||'',branchId:o.branch_id,branchName:o.branch_name||'Main Branch'}));
 const pendingRequests=branchId
  ?db.prepare(`SELECT COUNT(*) AS count FROM warehouse_requests WHERE status='pending' AND branch_id=?`).get(branchId).count
  :db.prepare("SELECT COUNT(*) AS count FROM warehouse_requests WHERE status='pending'").get().count;
 const activeDeliveries=branchId
  ?db.prepare("SELECT COUNT(*) AS count FROM deliveries d JOIN orders o ON o.id=d.order_id WHERE d.status!='delivered' AND o.branch_id=?").get(branchId).count
  :db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status!='delivered'").get().count;
 res.json({branchId,stats:{today:sales.today/100,week:sales.week/100,month:sales.month/100,todayOrders:sales.today_count,products:products.count,lowStock:products.low||0,customers:customerCount,pendingRequests,activeDeliveries},recent});
});
export default router;
