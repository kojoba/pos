import { Router } from 'express';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { feedbackOrderId } from '../feedback-service.js';

const router=Router();

function feedbackOrder(token){
 const id=feedbackOrderId(token);
 if(!id)return null;
 const order=db.prepare('SELECT id,ref,status,customer_name,fulfillment_type,created_at FROM orders WHERE id=?').get(id);
 if(!order)return null;
 const delivery=order.fulfillment_type==='delivery'?db.prepare('SELECT status FROM deliveries WHERE order_id=?').get(id):null;
 const eligible=order.status==='paid'&&(order.fulfillment_type!=='delivery'||delivery?.status==='delivered');
 const existing=db.prepare('SELECT id,status FROM customer_feedback WHERE order_id=?').get(id);
 return {order,delivery,eligible,existing};
}

router.get('/:token',(req,res)=>{
 const result=feedbackOrder(req.params.token);
 if(!result)return res.status(404).json({error:'This feedback link is invalid.'});
 if(result.existing)return res.json({alreadySubmitted:true,feedbackStatus:result.existing.status,order:{reference:result.order.ref}});
 const items=db.prepare('SELECT product_name AS name,quantity FROM order_items WHERE order_id=? ORDER BY id').all(result.order.id);
 return res.json({alreadySubmitted:false,eligible:result.eligible,
  message:result.eligible?'':result.order.status!=='paid'?'Feedback is available after payment is completed.':'Please wait until your delivery is marked delivered before submitting feedback.',
  order:{reference:result.order.ref,customerName:result.order.customer_name,fulfillmentType:result.order.fulfillment_type,items}});
});

router.post('/:token',(req,res)=>{
 const result=feedbackOrder(req.params.token);
 if(!result)return res.status(404).json({error:'This feedback link is invalid.'});
 if(result.existing)return res.status(409).json({error:'Feedback has already been submitted for this order.'});
 if(!result.eligible)return res.status(409).json({error:result.order.status!=='paid'?'Feedback is available after payment is completed.':'Feedback is available after the delivery is marked delivered.'});
 const foodRating=Number(req.body?.foodRating),serviceRating=Number(req.body?.serviceRating);
 const deliveryRating=req.body?.deliveryRating===null||req.body?.deliveryRating===undefined||req.body?.deliveryRating===''?null:Number(req.body.deliveryRating);
 const comment=String(req.body?.comment||'').trim().slice(0,2000);
 const validRating=value=>Number.isInteger(value)&&value>=1&&value<=5;
 if(!validRating(foodRating)||!validRating(serviceRating))return res.status(400).json({error:'Rate the food and service from 1 to 5 stars.'});
 if(result.order.fulfillment_type==='delivery'&&!validRating(deliveryRating))return res.status(400).json({error:'Rate the delivery from 1 to 5 stars.'});
 if(deliveryRating!==null&&!validRating(deliveryRating))return res.status(400).json({error:'Delivery rating must be from 1 to 5 stars.'});
 try{
  db.prepare(`INSERT INTO customer_feedback(order_id,food_rating,service_rating,delivery_rating,comment) VALUES(?,?,?,?,?)`)
   .run(result.order.id,foodRating,serviceRating,deliveryRating,comment);
  return res.status(201).json({ok:true,message:'Thank you for sharing your feedback.'});
 }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'Feedback has already been submitted for this order.'});throw error;}
});

router.get('/',requireAuth,requireRole('manager'),(req,res)=>{
 const feedback=db.prepare(`SELECT f.id,f.order_id AS orderId,o.ref AS orderReference,o.customer_name AS customerName,
  o.customer_phone AS customerPhone,o.fulfillment_type AS fulfillmentType,f.food_rating AS foodRating,
  f.service_rating AS serviceRating,f.delivery_rating AS deliveryRating,f.comment,f.status,
  f.reviewed_by_name AS reviewedBy,f.reviewed_at AS reviewedAt,f.created_at AS submittedAt
  FROM customer_feedback f JOIN orders o ON o.id=f.order_id WHERE (? IS NULL OR o.branch_id=?) ORDER BY f.id DESC LIMIT 500`).all(req.auth.branchId,req.auth.branchId);
 res.json({feedback});
});

router.patch('/:id/status',requireAuth,requireRole('manager'),(req,res)=>{
 const id=Number(req.params.id),status=String(req.body?.status||'');
 if(!['reviewed','follow_up'].includes(status))return res.status(400).json({error:'Choose reviewed or follow-up.'});
 const actor=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 const result=db.prepare(`UPDATE customer_feedback SET status=?,reviewed_by_id=?,reviewed_by_name=?,reviewed_at=datetime('now') WHERE id=? AND order_id IN (SELECT id FROM orders WHERE ? IS NULL OR branch_id=?)`).run(status,req.auth.id,actor.name,id,req.auth.branchId,req.auth.branchId);
 if(!result.changes)return res.status(404).json({error:'Feedback not found.'});
 return res.json({ok:true});
});

export default router;
