import { Router } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
import { canSendBroadcastEmail, sendCustomerBroadcastEmails } from '../email-service.js';
import { canSendBroadcastSms, getHubtelBatchStatus, hubtelPhone, sendHubtelBroadcast } from '../sms-service.js';

const router=Router();
const requireHeadOffice=(req,res,next)=>req.auth.branchId?res.status(403).json({error:'Customer records and broadcasts are managed centrally by the head office.'}):next();
const managerOnly=[requireAuth,requireRole('manager'),requireHeadOffice];
const columns=`id,name,phone,email,sms_marketing_consent,email_marketing_consent,consent_source,consent_updated_at,total_spent_pesewas,visits,last_visit`;
const baseUrl=()=>String(process.env.PUBLIC_BASE_URL||(process.env.NODE_ENV==='production'?'':process.env.CLIENT_ORIGIN||'http://localhost:5173')).replace(/\/$/,'');

function escapeHtml(value){return String(value||'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));}
function consentToken(customerId,channel){
 const payload=`${customerId}:${channel}`;
 const secret=process.env.CUSTOMER_UNSUBSCRIBE_SECRET||process.env.JWT_SECRET||'local-development-secret-change-before-deploying';
 const signature=createHmac('sha256',secret).update(payload).digest('hex');
 return Buffer.from(`${payload}:${signature}`).toString('base64url');
}
function verifyConsentToken(token){
 try{
  const decoded=Buffer.from(String(token||''),'base64url').toString('utf8');
  const [idText,channel,signature]=decoded.split(':');
  const id=Number(idText);
  if(!Number.isInteger(id)||id<1||!['email','sms'].includes(channel)||!signature)return null;
  const payload=`${id}:${channel}`;
  const secret=process.env.CUSTOMER_UNSUBSCRIBE_SECRET||process.env.JWT_SECRET||'local-development-secret-change-before-deploying';
  const expected=createHmac('sha256',secret).update(payload).digest('hex');
  const a=Buffer.from(signature),b=Buffer.from(expected);
  if(a.length!==b.length||!timingSafeEqual(a,b))return null;
  return {id,channel};
 }catch{return null;}
}
function publicUnsubscribeUrl(customerId,channel){
 return `${baseUrl()}/api/customers/opt-out?token=${encodeURIComponent(consentToken(customerId,channel))}`;
}
function mapCustomer(c){return {id:c.id,name:c.name,phone:c.phone,email:c.email||'',smsMarketingConsent:Boolean(c.sms_marketing_consent),emailMarketingConsent:Boolean(c.email_marketing_consent),consentSource:c.consent_source||'',consentUpdatedAt:c.consent_updated_at,totalSpent:c.total_spent_pesewas/100,visits:c.visits,lastVisit:c.last_visit};}

router.get('/opt-out',(req,res)=>{
 const token=String(req.query.token||'');
 if(!verifyConsentToken(token))return res.status(400).type('html').send('<h2>Invalid or expired unsubscribe link</h2><p>Please contact Daddy’s Pizza to update your communication preferences.</p>');
 res.type('html').send(`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Communication preferences</title></head><body style="font:16px Arial,sans-serif;max-width:520px;margin:12vh auto;padding:24px;color:#292a27"><h2>Unsubscribe from updates?</h2><p>Confirm to stop receiving Daddy’s Pizza ${escapeHtml(verifyConsentToken(token).channel)} messages.</p><form method="post" action="/api/customers/opt-out"><input type="hidden" name="token" value="${escapeHtml(token)}"><button style="background:#df6835;color:#fff;border:0;border-radius:7px;padding:12px 18px;font-weight:bold">Confirm unsubscribe</button></form></body></html>`);
});
router.post('/opt-out',(req,res)=>{
 const target=verifyConsentToken(req.body?.token||req.query.token);
 if(!target)return res.status(400).type('html').send('<h2>Invalid unsubscribe link</h2><p>Please contact Daddy’s Pizza to update your communication preferences.</p>');
 const column=target.channel==='email'?'email_marketing_consent':'sms_marketing_consent';
 const customer=db.prepare(`SELECT id,name FROM customers WHERE id=?`).get(target.id);
 if(!customer)return res.status(404).type('html').send('<h2>Customer not found</h2>');
 db.transaction(()=>{
  db.prepare(`UPDATE customers SET ${column}=0,consent_source='Customer unsubscribe link',consent_updated_at=datetime('now') WHERE id=?`).run(customer.id);
  db.prepare(`INSERT INTO customer_consent_events(customer_id,channel,consent_given,source,changed_by_name) VALUES(?,?,0,'Customer unsubscribe link','Customer')`).run(customer.id,target.channel);
 })();
 return res.type('html').send('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Unsubscribed</title></head><body style="font:16px Arial,sans-serif;max-width:520px;margin:12vh auto;padding:24px;color:#292a27"><h2>You are unsubscribed</h2><p>Your preference has been updated. You will no longer receive this type of promotional message from Daddy’s Pizza.</p></body></html>');
});

router.get('/',...managerOnly,(_req,res)=>{
 const customers=db.prepare(`SELECT ${columns} FROM customers ORDER BY last_visit DESC,name`).all().map(mapCustomer);
 res.json({customers});
});

router.post('/',...managerOnly,(req,res)=>{
 const name=String(req.body?.name||'').trim().slice(0,100);
 const phone=String(req.body?.phone||'').trim().slice(0,30);
 const email=String(req.body?.email||'').trim().toLowerCase();
 const smsConsent=req.body?.smsMarketingConsent===true?1:0;
 const emailConsent=req.body?.emailMarketingConsent===true?1:0;
 const source=String(req.body?.consentSource||'').trim().slice(0,160);
 if(!name||!phone)return res.status(400).json({error:'Enter a customer name and phone number.'});
 if(email&&!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
 if(smsConsent&&!/^((\+?233)|0)\d{9}$/.test(phone.replace(/[\s()-]/g,'')))return res.status(400).json({error:'Enter a valid Ghana mobile number before enabling SMS updates.'});
 if(emailConsent&&!email)return res.status(400).json({error:'Add an email address before enabling email updates.'});
 if((smsConsent||emailConsent)&&!source)return res.status(400).json({error:'Record where the customer gave permission before enabling marketing messages.'});
 const actor=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 try{
  const result=db.transaction(()=>{
   const created=db.prepare(`INSERT INTO customers(name,phone,email,sms_marketing_consent,email_marketing_consent,consent_source,consent_updated_at) VALUES(?,?,?,?,?,?,CASE WHEN ?=1 OR ?=1 THEN datetime('now') ELSE NULL END)`).run(name,phone,email,smsConsent,emailConsent,source,smsConsent,emailConsent);
   if(smsConsent)db.prepare(`INSERT INTO customer_consent_events(customer_id,channel,consent_given,source,changed_by_id,changed_by_name) VALUES(?,'sms',1,?,?,?)`).run(created.lastInsertRowid,source,req.auth.id,actor.name);
   if(emailConsent)db.prepare(`INSERT INTO customer_consent_events(customer_id,channel,consent_given,source,changed_by_id,changed_by_name) VALUES(?,'email',1,?,?,?)`).run(created.lastInsertRowid,source,req.auth.id,actor.name);
   return created;
  })();
  return res.status(201).json({customer:mapCustomer(db.prepare(`SELECT ${columns} FROM customers WHERE id=?`).get(result.lastInsertRowid))});
 }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That phone number already belongs to a customer.'});throw error;}
});

router.patch('/:id',...managerOnly,(req,res)=>{
 const id=Number(req.params.id),customer=db.prepare('SELECT * FROM customers WHERE id=?').get(id);
 if(!customer)return res.status(404).json({error:'Customer not found.'});
 const name=String(req.body?.name??customer.name).trim().slice(0,100);
 const phone=String(req.body?.phone??customer.phone).trim().slice(0,30);
 const email=String(req.body?.email??customer.email??'').trim().toLowerCase();
 const smsConsent=req.body?.smsMarketingConsent===true?1:0;
 const emailConsent=req.body?.emailMarketingConsent===true?1:0;
 const source=String(req.body?.consentSource||customer.consent_source||'').trim().slice(0,160);
 if(!name||!phone)return res.status(400).json({error:'Enter a customer name and phone number.'});
 if(email&&!/^\S+@\S+\.\S+$/.test(email))return res.status(400).json({error:'Enter a valid email address.'});
 if(smsConsent&&!/^(\+?233|0)\d{9}$/.test(phone.replace(/[\s()-]/g,'')))return res.status(400).json({error:'Enter a valid Ghana mobile number before enabling SMS updates.'});
 if(emailConsent&&!email)return res.status(400).json({error:'Add an email address before enabling email updates.'});
 if((smsConsent&&!customer.sms_marketing_consent)||(emailConsent&&!customer.email_marketing_consent)){
  if(!source)return res.status(400).json({error:'Record where the customer gave permission before enabling marketing messages.'});
 }
 const actor=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 try{
  db.transaction(()=>{
   db.prepare(`UPDATE customers SET name=?,phone=?,email=?,sms_marketing_consent=?,email_marketing_consent=?,consent_source=?,consent_updated_at=CASE WHEN sms_marketing_consent!=? OR email_marketing_consent!=? THEN datetime('now') ELSE consent_updated_at END WHERE id=?`)
    .run(name,phone,email,smsConsent,emailConsent,source,smsConsent,emailConsent,id);
   if(Boolean(customer.sms_marketing_consent)!==Boolean(smsConsent))db.prepare(`INSERT INTO customer_consent_events(customer_id,channel,consent_given,source,changed_by_id,changed_by_name) VALUES(?,'sms',?,?,?,?)`).run(id,smsConsent,source,req.auth.id,actor.name);
   if(Boolean(customer.email_marketing_consent)!==Boolean(emailConsent))db.prepare(`INSERT INTO customer_consent_events(customer_id,channel,consent_given,source,changed_by_id,changed_by_name) VALUES(?,'email',?,?,?,?)`).run(id,emailConsent,source,req.auth.id,actor.name);
  })();
 }catch(error){if(error.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That phone number already belongs to another customer.'});throw error;}
 res.json({customer:mapCustomer(db.prepare(`SELECT ${columns} FROM customers WHERE id=?`).get(id))});
});

router.get('/broadcasts',...managerOnly,(_req,res)=>{
 const broadcasts=db.prepare(`SELECT b.*,COUNT(r.id) AS recipient_count,
  SUM(CASE WHEN r.status IN ('accepted','delivered') THEN 1 ELSE 0 END) AS accepted_count_live,
  SUM(CASE WHEN r.status='failed' THEN 1 ELSE 0 END) AS failed_count_live
  FROM customer_broadcasts b LEFT JOIN customer_broadcast_recipients r ON r.broadcast_id=b.id
  GROUP BY b.id ORDER BY b.id DESC LIMIT 50`).all().map(b=>({id:b.id,channel:b.channel,subject:b.subject,message:b.message,sentBy:b.sent_by_name,status:b.status,totalRecipients:b.recipient_count,acceptedCount:b.accepted_count_live||0,failedCount:b.failed_count_live||0,createdAt:b.created_at,completedAt:b.completed_at,providerBatchId:b.provider_batch_id||''}));
 res.json({broadcasts});
});

router.get('/broadcasts/:id/recipients',...managerOnly,(req,res)=>{
 const id=Number(req.params.id),broadcast=db.prepare('SELECT id FROM customer_broadcasts WHERE id=?').get(id);
 if(!broadcast)return res.status(404).json({error:'Broadcast not found.'});
 const recipients=db.prepare(`SELECT customer_name AS customerName,destination,status,provider_message_id AS providerMessageId,error_message AS errorMessage,sent_at AS sentAt,updated_at AS updatedAt FROM customer_broadcast_recipients WHERE broadcast_id=? ORDER BY id`).all(id);
 res.json({recipients});
});

router.post('/broadcasts/:id/refresh',...managerOnly,async(req,res)=>{
 const id=Number(req.params.id),broadcast=db.prepare('SELECT * FROM customer_broadcasts WHERE id=?').get(id);
 if(!broadcast)return res.status(404).json({error:'Broadcast not found.'});
 if(broadcast.channel!=='sms'||!broadcast.provider_batch_id)return res.status(400).json({error:'Delivery refresh is available for Hubtel SMS broadcasts only.'});
 try{
  const data=await getHubtelBatchStatus(broadcast.provider_batch_id);
  const rows=Array.isArray(data.data)?data.data:[];
  const update=db.prepare(`UPDATE customer_broadcast_recipients SET status=?,updated_at=datetime('now') WHERE broadcast_id=? AND destination=?`);
  db.transaction(()=>rows.forEach(row=>{
   const phone=String(row.recipient||row.to||'').replace(/\D/g,'');
   const providerStatus=String(row.status||'').toLowerCase();
   const status=providerStatus==='delivered'?'delivered':['undelivered','failed','rejected','expired','blacklisted','unrouteable','error'].includes(providerStatus)?'failed':'accepted';
   if(phone)update.run(status,id,phone);
  }))();
  const counts=db.prepare(`SELECT SUM(CASE WHEN status IN ('accepted','delivered') THEN 1 ELSE 0 END) AS ok,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM customer_broadcast_recipients WHERE broadcast_id=?`).get(id);
  db.prepare(`UPDATE customer_broadcasts SET accepted_count=?,failed_count=? WHERE id=?`).run(counts.ok||0,counts.failed||0,id);
  return res.json({ok:true});
 }catch(error){return res.status(502).json({error:error.message||'Could not refresh Hubtel delivery statuses.'});}
});

router.post('/broadcasts',...managerOnly,async(req,res)=>{
 const channel=String(req.body?.channel||'').toLowerCase();
 const subject=String(req.body?.subject||'').trim().slice(0,160);
 const message=String(req.body?.message||'').trim();
 const selected=Array.isArray(req.body?.customerIds)?[...new Set(req.body.customerIds.map(Number).filter(Number.isInteger))]:[];
 if(!['email','sms'].includes(channel))return res.status(400).json({error:'Choose email or SMS.'});
 if(!message||message.length>(channel==='sms'?1000:10000))return res.status(400).json({error:channel==='sms'?'SMS message must be between 1 and 1,000 characters.':'Email message must be between 1 and 10,000 characters.'});
 if(channel==='email'&&!subject)return res.status(400).json({error:'Enter an email subject.'});
 if(channel==='email'&&!canSendBroadcastEmail())return res.status(503).json({error:'Email is not configured. Set RESEND_API_KEY and RESEND_FROM_EMAIL, or configure Gmail SMTP.'});
 if(channel==='sms'&&!canSendBroadcastSms())return res.status(503).json({error:'SMS is not configured. Set Hubtel SMS client ID, secret and approved sender ID.'});
 if(process.env.NODE_ENV==='production'&&!process.env.PUBLIC_BASE_URL?.trim())return res.status(503).json({error:'Set PUBLIC_BASE_URL to the deployed app URL before sending broadcasts so customers receive working opt-out links.'});
 if(!selected.length)return res.status(400).json({error:'Select at least one opted-in customer for this broadcast.'});
 const consentColumn=channel==='email'?'email_marketing_consent':'sms_marketing_consent';
 let eligible=db.prepare(`SELECT id,name,phone,email FROM customers WHERE ${consentColumn}=1`).all();
 eligible=eligible.filter(c=>channel==='email'?/^\S+@\S+\.\S+$/.test(c.email||''):Boolean(hubtelPhone(c.phone)));
 if(selected.length){const selectedSet=new Set(selected);const chosen=eligible.filter(c=>selectedSet.has(c.id));if(chosen.length!==selectedSet.size)return res.status(400).json({error:'One or more selected customers lack valid contact details or have not opted in for this channel.'});eligible=chosen;}
 if(!eligible.length)return res.status(400).json({error:'There are no opted-in customers with a valid contact for this channel.'});
 if(eligible.length>100)return res.status(400).json({error:`This broadcast would reach ${eligible.length} people. Select no more than 100 opted-in customers per broadcast.`});
 const actor=db.prepare('SELECT name FROM users WHERE id=?').get(req.auth.id);
 let broadcastId;
 try{
  const create=db.transaction(()=>{
   const result=db.prepare(`INSERT INTO customer_broadcasts(channel,subject,message,sent_by_id,sent_by_name,total_recipients,status) VALUES(?,?,?,?,?,?, 'processing')`).run(channel,subject,message,req.auth.id,actor.name,eligible.length);
   broadcastId=result.lastInsertRowid;
   const insert=db.prepare(`INSERT INTO customer_broadcast_recipients(broadcast_id,customer_id,customer_name,destination) VALUES(?,?,?,?)`);
   for(const customer of eligible)insert.run(broadcastId,customer.id,customer.name,channel==='email'?customer.email:hubtelPhone(customer.phone));
  });
  create();
 }catch(error){return res.status(500).json({error:'Could not create the broadcast record.'});}

 const recipientRows=db.prepare('SELECT id,customer_id AS customerId,customer_name AS name,destination FROM customer_broadcast_recipients WHERE broadcast_id=? ORDER BY id').all(broadcastId);
 const update=db.prepare(`UPDATE customer_broadcast_recipients SET status=?,provider_message_id=?,error_message=?,sent_at=datetime('now'),updated_at=datetime('now') WHERE id=?`);
 let batchId='';
 if(channel==='sms'){
  try{
   const smsRecipients=recipientRows.map(row=>({customerId:row.customerId,name:row.name,phone:row.destination,
    unsubscribeUrl:publicUnsubscribeUrl(row.customerId,'sms')}));
   const result=await sendHubtelBroadcast({recipients:smsRecipients,message});
   batchId=result.batchId;
   db.transaction(()=>result.results.forEach(item=>{
    const row=recipientRows.find(candidate=>candidate.customerId===item.customerId);
    if(row)update.run(item.accepted?'accepted':'failed',item.messageId,item.error,row.id);
   }))();
  }catch(error){db.transaction(()=>recipientRows.forEach(row=>update.run('failed','',error.message,row.id)))();}
 }else{
  try{
   const emailMessages=recipientRows.map(row=>({to:row.destination,customerName:row.name,subject,
    message:message.replaceAll('{{name}}',row.name),unsubscribeUrl:publicUnsubscribeUrl(row.customerId,'email')}));
   const results=await sendCustomerBroadcastEmails(emailMessages);
   recipientRows.forEach((row,index)=>{
    const result=results[index];
    const error=result?.error||(!result?.messageId?'Email provider did not return a message ID.':'');
    update.run(error?'failed':'accepted',result?.messageId||'',error,row.id);
   });
  }catch(error){db.transaction(()=>recipientRows.forEach(row=>update.run('failed','',error.message||'Email could not be sent.',row.id)))();}
 }
 const counts=db.prepare(`SELECT COUNT(*) AS total,SUM(CASE WHEN status IN ('accepted','delivered') THEN 1 ELSE 0 END) AS accepted,SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed FROM customer_broadcast_recipients WHERE broadcast_id=?`).get(broadcastId);
 const status=counts.failed===0?'sent':counts.accepted===0?'failed':'partial';
 db.prepare(`UPDATE customer_broadcasts SET status=?,accepted_count=?,failed_count=?,provider_batch_id=?,completed_at=datetime('now') WHERE id=?`).run(status,counts.accepted||0,counts.failed||0,batchId,broadcastId);
 return res.status(201).json({ok:true,id:broadcastId,status,totalRecipients:counts.total,acceptedCount:counts.accepted||0,failedCount:counts.failed||0});
});

export default router;
