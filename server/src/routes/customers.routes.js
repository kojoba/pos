import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router=Router();
router.get('/',requireAuth,requireRole('manager'),(_req,res)=>{
 const customers=db.prepare('SELECT id,name,phone,total_spent_pesewas,visits,last_visit FROM customers ORDER BY last_visit DESC').all().map(c=>({id:c.id,name:c.name,phone:c.phone,totalSpent:c.total_spent_pesewas/100,visits:c.visits,lastVisit:c.last_visit}));res.json({customers});
});
export default router;
