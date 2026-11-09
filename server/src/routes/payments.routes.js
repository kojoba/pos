import { Router } from 'express';
import { createHmac, timingSafeEqual, randomUUID } from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { failPendingOrder, publicOrder, settlePendingOrder } from '../order-service.js';
import { parseDeliveryDetails } from '../delivery-utils.js';
import { resolveBranchId } from '../branch-access.js';
const router=Router();
const providerCodes={mtn:'mtn',at:'atl',telecel:'vod'};
function secret(){return process.env.PAYSTACK_SECRET_KEY||'';}
async function paystackFetch(path,options={}){
 const key=secret();if(!key)throw new Error('Paystack is not configured. Add PAYSTACK_SECRET_KEY to the server environment.');
 const response=await fetch(`https://api.paystack.co${path}`,{...options,headers:{Authorization:`Bearer ${key}`,'Content-Type':'application/json',...(options.headers||{})},signal:AbortSignal.timeout(20000)});
 const data=await response.json().catch(()=>({}));
 // Paystack documents "Charge attempted" as the normal acknowledgement for
 // an asynchronous charge. If the response includes our exact reference,
 // keep it pending and verify it instead of failing the order and releasing stock.
 const acknowledgedCharge=path==='/charge'&&data.message==='Charge attempted'&&data.data?.reference;
 if((!response.ok||data.status===false)&&!acknowledgedCharge)throw new Error(data.message||'Paystack could not process the request.');
 return data;
}
function normalizeGhanaPhone(value){
 // Work from digits only so spaces, parentheses, dashes and a leading +
 // cannot cause a valid Ghana number to be rejected.
 let digits=String(value??'').replace(/\D/g,'');
 if(digits.startsWith('00'))digits=digits.slice(2);
 if(digits.startsWith('233'))digits=digits.slice(3);
 if(digits.length===9)digits=`0${digits}`;
 return /^0[0-9]{9}$/.test(digits)?digits:null;
}
function transactionReference(){return `DPmomo${Date.now()}${randomUUID().replaceAll('-','').slice(0,12)}`;}
function paymentItems(lines){if(!Array.isArray(lines)||!lines.length||lines.length>100)throw new Error('Add at least one product to the cart.');const quantities=new Map();for(const line of lines){const id=Number(line.productId),qty=Number(line.quantity);if(!Number.isInteger(id)||!Number.isInteger(qty)||qty<1||qty>1000)throw new Error('One or more cart quantities are invalid.');quantities.set(id,(quantities.get(id)||0)+qty);}return [...quantities];}
function createPendingOrder(req,{phone,lines,customerName,delivery,branchId}){return db.transaction(()=>{
 let total=delivery.deliveryFeePesewas;const products=[];for(const [id,quantity] of lines){const product=db.prepare(`SELECT p.*,bi.on_hand AS stock,bi.reserved FROM products p JOIN branch_inventory bi ON bi.product_id=p.id AND bi.branch_id=? WHERE p.id=? AND p.active=1`).get(branchId,id);if(!product)throw new Error('A product in your cart is not stocked at this branch.');const available=product.stock-product.reserved;if(available<quantity)throw new Error(`Not enough stock for ${product.name} at this branch. Available: ${available}.`);products.push({product,quantity});total+=product.price_pesewas*quantity;}
 const ref=transactionReference(),cashier=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 const order=db.prepare(`INSERT INTO orders(ref,total_pesewas,payment_method,customer_name,customer_phone,customer_email,fulfillment_type,delivery_address,delivery_instructions,delivery_fee_pesewas,payment_reference,payment_message,cashier_id,cashier_name,branch_id,status) VALUES(?,?,?,?,?,?,?,?,?,?,?,'Waiting for Paystack mobile money authorization.',?,?,?, 'pending')`).run(ref,total,'Paystack Mobile Money',customerName,phone,delivery.customerEmail||'',delivery.fulfillmentType,delivery.deliveryAddress,delivery.deliveryInstructions,delivery.deliveryFeePesewas,ref,req.auth.id,cashier.name,branchId);
 for(const {product,quantity} of products){db.prepare('INSERT INTO order_items(order_id,product_id,product_name,unit_price_pesewas,quantity) VALUES(?,?,?,?,?)').run(order.lastInsertRowid,product.id,product.name,product.price_pesewas,quantity);db.prepare(`UPDATE branch_inventory SET reserved=reserved+?,updated_at=datetime('now') WHERE branch_id=? AND product_id=?`).run(quantity,branchId,product.id);}
 return db.prepare('SELECT * FROM orders WHERE id=?').get(order.lastInsertRowid);
})();}
async function verifyAndApply(reference){
 const local=db.prepare('SELECT * FROM orders WHERE payment_reference=?').get(reference);if(!local)return {notFound:true};
 if(local.status!=='pending')return {order:local,status:local.status,message:local.payment_message||''};
 const response=await paystackFetch(`/transaction/verify/${encodeURIComponent(reference)}`,{method:'GET'}),data=response.data||{};
 if(data.reference!==reference||Number(data.amount)!==local.total_pesewas||data.currency!=='GHS')throw new Error('Paystack verification did not match this order amount, currency and reference. The order remains pending for review.');
 if(data.status==='success'){const settled=settlePendingOrder(local.id,data.gateway_response||'Payment confirmed by Paystack.');return {order:settled,status:settled.status,message:data.gateway_response||'Payment confirmed by Paystack.'};}
 if(['failed','abandoned','reversed'].includes(data.status)){const message=data.message||data.gateway_response||'The mobile money payment was not completed.';const failed=failPendingOrder(local.id,message);return {order:failed,status:failed.status,message};}
 return {order:local,status:'pending',message:local.payment_message||'Waiting for approval on the customer’s phone.'};
}
router.post('/momo',requireAuth,requireRole('manager','worker'),async(req,res)=>{
 let branchId;try{branchId=resolveBranchId(req.auth,req.body?.branchId)}catch(e){return res.status(400).json({error:e.message});}
 const email=String(req.body?.email||'').trim().toLowerCase(),phone=String(req.body?.phone||req.body?.customerPhone||'').trim(),provider=String(req.body?.provider||'').toLowerCase(),customerName=String(req.body?.customerName||'Walk-in customer').trim().slice(0,100)||'Walk-in customer';
 let lines;try{lines=paymentItems(req.body?.items);}catch(e){return res.status(400).json({error:e.message});}
 if(!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Enter a valid customer email for the Paystack charge.'});
 const normalizedPhone=normalizeGhanaPhone(phone);
 if(!normalizedPhone)return res.status(400).json({error:'Enter a valid 10-digit Ghana mobile number, for example 0241234567 or +233241234567.'});
 let delivery;try{delivery=parseDeliveryDetails(req.body,normalizedPhone);}catch(e){return res.status(400).json({error:e.message});}
 if(!providerCodes[provider])return res.status(400).json({error:'Choose MTN, AT Money/AirtelTigo or Telecel.'});
 if(!secret())return res.status(503).json({error:'Paystack is not configured yet. Add PAYSTACK_SECRET_KEY to server/.env.'});
 let order;try{order=createPendingOrder(req,{phone:normalizedPhone,lines,customerName,delivery,branchId});}catch(e){return res.status(400).json({error:e.message});}
 try{
  const response=await paystackFetch('/charge',{method:'POST',body:JSON.stringify({email,amount:order.total_pesewas,currency:'GHS',reference:order.payment_reference,mobile_money:{phone:normalizedPhone,provider:providerCodes[provider]}})}),data=response.data||{};
  if(data.reference&&data.reference!==order.payment_reference)throw new Error('Paystack returned a different payment reference. Please check the transaction before retrying.');
  if(response.message==='Charge attempted'&&!data.reference)throw new Error('Paystack acknowledged the charge without returning a reference. Check Paystack before retrying.');
  const message=data.display_text||response.message||'Approve the Paystack payment prompt on the customer’s phone.';db.prepare('UPDATE orders SET payment_message=? WHERE id=?').run(message,order.id);
  if(data.status==='success'){const result=await verifyAndApply(order.payment_reference);return res.status(201).json({reference:order.payment_reference,order:publicOrder(result.order),status:result.status,displayText:message});}
  return res.status(202).json({reference:order.payment_reference,order:publicOrder(db.prepare('SELECT * FROM orders WHERE id=?').get(order.id)),status:'pending',displayText:message});
 }catch(e){
  if(e.name==='AbortError'||e.name==='TimeoutError'||e instanceof TypeError)return res.status(202).json({reference:order.payment_reference,order:publicOrder(order),status:'pending',displayText:'Paystack’s response is taking longer than expected. Check the customer’s phone, then use “Check payment status” before starting another payment.'});
  const failed=failPendingOrder(order.id,e.message);return res.status(502).json({error:e.message,order:publicOrder(failed),status:'failed'});
 }
});
router.get('/:reference/status',requireAuth,requireRole('manager','worker'),async(req,res)=>{
 const reference=String(req.params.reference||''),local=db.prepare('SELECT * FROM orders WHERE payment_reference=?').get(reference);
 if(!local)return res.status(404).json({error:'Paystack payment not found.'});
 if(req.auth.branchId&&local.branch_id!==req.auth.branchId)return res.status(403).json({error:'This payment belongs to another branch.'});
 if(req.auth.role!=='manager'&&local.cashier_id!==req.auth.id)return res.status(403).json({error:'This payment belongs to another cashier.'});
 if(local.status!=='pending')return res.json({reference,status:local.status,order:publicOrder(local),displayText:local.payment_message});
 try{const result=await verifyAndApply(reference);return res.json({reference,status:result.status,order:publicOrder(result.order),displayText:result.message});}
 catch(e){return res.status(502).json({error:e.message,reference,status:'pending'});}
});
router.post('/paystack/webhook',async(req,res)=>{
 const key=secret(),signature=req.get('x-paystack-signature');if(!key||!signature||!Buffer.isBuffer(req.rawBody))return res.status(401).send('Invalid Paystack webhook signature.');
 const expected=createHmac('sha512',key).update(req.rawBody).digest('hex'),expectedBuffer=Buffer.from(expected,'hex'),providedBuffer=Buffer.from(signature,'hex');
 if(expectedBuffer.length!==providedBuffer.length||!timingSafeEqual(expectedBuffer,providedBuffer))return res.status(401).send('Invalid Paystack webhook signature.');
 if(req.body?.event!=='charge.success')return res.sendStatus(200);
 const reference=String(req.body?.data?.reference||'');if(!reference)return res.status(400).send('Missing transaction reference.');
 try{const result=await verifyAndApply(reference);if(result.notFound)return res.sendStatus(200);return res.sendStatus(200);}
 catch(e){console.error(`Paystack webhook verification failed for ${reference}:`,e.message);return res.status(500).send('Payment verification could not be completed.');}
});
export default router;
