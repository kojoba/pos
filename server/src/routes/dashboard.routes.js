import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router=Router();
router.get('/',requireAuth,requireRole('manager'),(_req,res)=>{
 const sales=db.prepare(`SELECT
  COALESCE(SUM(CASE WHEN date(created_at)=date('now','localtime') THEN total_pesewas ELSE 0 END),0) AS today,
  COALESCE(SUM(CASE WHEN date(created_at)>=date('now','weekday 1','-7 days','localtime') THEN total_pesewas ELSE 0 END),0) AS week,
  COALESCE(SUM(CASE WHEN strftime('%Y-%m',created_at)=strftime('%Y-%m','now','localtime') THEN total_pesewas ELSE 0 END),0) AS month,
  COUNT(CASE WHEN date(created_at)=date('now','localtime') THEN 1 END) AS today_count
  FROM orders WHERE status='paid'`).get();
 const products=db.prepare('SELECT COUNT(*) AS count, SUM(CASE WHEN stock-reserved<=reorder_level THEN 1 ELSE 0 END) AS low FROM products WHERE active=1').get();
 const customerCount=db.prepare('SELECT COUNT(*) AS count FROM customers').get().count;
 const recent=db.prepare(`SELECT o.*, GROUP_CONCAT(oi.product_name || ' ×' || oi.quantity, ', ') AS item_summary FROM orders o LEFT JOIN order_items oi ON oi.order_id=o.id WHERE o.status='paid' GROUP BY o.id ORDER BY o.id DESC LIMIT 8`).all().map(o=>({id:o.id,ref:o.ref,total:o.total_pesewas/100,paymentMethod:o.payment_method,customerName:o.customer_name,cashier:o.cashier_name,createdAt:o.created_at,items:o.item_summary||''}));
 const pendingRequests=db.prepare("SELECT COUNT(*) AS count FROM stock_requests WHERE status='pending'").get().count;
 const activeDeliveries=db.prepare("SELECT COUNT(*) AS count FROM deliveries WHERE status!='delivered'").get().count;
 res.json({stats:{today:sales.today/100,week:sales.week/100,month:sales.month/100,todayOrders:sales.today_count,products:products.count,lowStock:products.low||0,customers:customerCount,pendingRequests,activeDeliveries},recent});
});
export default router;
