import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router=Router();
const manager=[requireAuth,requireRole('manager')];
function userById(id){return db.prepare(`SELECT u.id,u.username,u.name,u.role,u.phone,u.branch_id AS branchId,b.name AS branchName,u.active,u.created_at AS createdAt FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.id=?`).get(id);}
router.get('/',...manager,(req,res)=>{
 const rows=req.auth.branchId
  ?db.prepare(`SELECT u.id,u.username,u.name,u.role,u.phone,u.branch_id AS branchId,b.name AS branchName,u.active,u.created_at AS createdAt FROM users u LEFT JOIN branches b ON b.id=u.branch_id WHERE u.branch_id=? AND u.role!='manager' ORDER BY u.name`).all(req.auth.branchId)
  :db.prepare(`SELECT u.id,u.username,u.name,u.role,u.phone,u.branch_id AS branchId,b.name AS branchName,u.active,u.created_at AS createdAt FROM users u LEFT JOIN branches b ON b.id=u.branch_id ORDER BY u.name`).all();
 res.json({users:rows.map(u=>({...u,active:Boolean(u.active)}))});
});
router.post('/',...manager,(req,res)=>{
 const username=String(req.body?.username||'').trim().toLowerCase(),name=String(req.body?.name||'').trim(),password=String(req.body?.password||''),phone=String(req.body?.phone||'').trim(),role=String(req.body?.role||'worker');
 const branchId=req.auth.branchId||Number(req.body?.branchId)||null;
 if(!/^[a-z0-9._-]{3,30}$/.test(username)||!name||password.length<8||!['manager','worker','rider'].includes(role))return res.status(400).json({error:'Use a 3–30 character username, full name, password with at least 8 characters, and valid role.'});
 if(req.auth.branchId&&role==='manager')return res.status(403).json({error:'Branch managers can create worker and rider accounts only.'});
 if(role!=='manager'&&!branchId)return res.status(400).json({error:'Assign workers and riders to a branch.'});
 if(branchId&&!db.prepare('SELECT id FROM branches WHERE id=? AND active=1').get(branchId))return res.status(400).json({error:'Choose an active branch.'});
 try{const result=db.prepare('INSERT INTO users(username,name,password_hash,role,phone,branch_id) VALUES(?,?,?,?,?,?)').run(username,name,bcrypt.hashSync(password,12),role,phone,branchId);res.status(201).json({user:userById(result.lastInsertRowid)});}catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That username is already in use.'});throw e;}
});
router.patch('/:id',...manager,(req,res)=>{
 const id=Number(req.params.id),user=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!user)return res.status(404).json({error:'User not found.'});
 if(req.auth.branchId&&(user.branch_id!==req.auth.branchId||user.role==='manager'))return res.status(404).json({error:'User not found.'});
 const name=String(req.body?.name??user.name).trim(),phone=String(req.body?.phone??user.phone).trim(),role=String(req.body?.role??user.role),password=String(req.body?.password||'');
 if(!name||!['manager','worker','rider'].includes(role))return res.status(400).json({error:'Enter a valid name and role.'});
 if(req.auth.branchId&&role==='manager')return res.status(403).json({error:'Branch managers cannot assign the manager role.'});
 if(password&&password.length<8)return res.status(400).json({error:'Passwords must be at least 8 characters.'});
 if(id===req.auth.id&&role!=='manager')return res.status(400).json({error:'You cannot change your own manager role.'});
 const branchId=req.auth.branchId|| (req.body?.branchId===undefined?user.branch_id:(Number(req.body.branchId)||null));
 if(role!=='manager'&&!branchId)return res.status(400).json({error:'Assign workers and riders to a branch.'});
 if(branchId&&!db.prepare('SELECT id FROM branches WHERE id=? AND active=1').get(branchId))return res.status(400).json({error:'Choose an active branch.'});
 const active=req.body?.active===undefined?user.active:(req.body.active?1:0);
 if(id===req.auth.id&&!active)return res.status(400).json({error:'You cannot deactivate your own account.'});
 db.prepare(`UPDATE users SET name=?,phone=?,role=?,branch_id=?,active=?,password_hash=CASE WHEN ?='' THEN password_hash ELSE ? END WHERE id=?`).run(name,phone,role,branchId,active,password,password?bcrypt.hashSync(password,12):'',id);
 res.json({user:userById(id)});
});
export default router;
