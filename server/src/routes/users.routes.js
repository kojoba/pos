import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, requireRole } from '../auth.js';
const router=Router();
router.get('/',requireAuth,requireRole('manager'),(_req,res)=>res.json({users:db.prepare('SELECT id,username,name,role,phone,active,created_at AS createdAt FROM users ORDER BY name').all().map(u=>({...u,active:Boolean(u.active)}))}));
router.post('/',requireAuth,requireRole('manager'),(req,res)=>{
 const username=String(req.body?.username||'').trim().toLowerCase(),name=String(req.body?.name||'').trim(),password=String(req.body?.password||''),phone=String(req.body?.phone||'').trim(),role=String(req.body?.role||'worker');
 if(!/^[a-z0-9._-]{3,30}$/.test(username)||!name||password.length<8||!['manager','worker','rider'].includes(role))return res.status(400).json({error:'Use a 3–30 character username, full name, password with at least 8 characters, and valid role.'});
 try{const result=db.prepare('INSERT INTO users(username,name,password_hash,role,phone) VALUES(?,?,?,?,?)').run(username,name,bcrypt.hashSync(password,12),role,phone);res.status(201).json({user:db.prepare('SELECT id,username,name,role,phone,active FROM users WHERE id=?').get(result.lastInsertRowid)});}catch(e){if(e.code==='SQLITE_CONSTRAINT_UNIQUE')return res.status(409).json({error:'That username is already in use.'});throw e;}
});
router.patch('/:id',requireAuth,requireRole('manager'),(req,res)=>{
 const id=Number(req.params.id),user=db.prepare('SELECT * FROM users WHERE id=?').get(id);if(!user)return res.status(404).json({error:'User not found.'});
 const name=String(req.body?.name??user.name).trim(),phone=String(req.body?.phone??user.phone).trim(),role=String(req.body?.role??user.role),password=String(req.body?.password||'');
 if(!name||!['manager','worker','rider'].includes(role))return res.status(400).json({error:'Enter a valid name and role.'});
 if(password&&password.length<8)return res.status(400).json({error:'Passwords must be at least 8 characters.'});
 if(id===req.auth.id&&role!=='manager')return res.status(400).json({error:'You cannot change your own manager role.'});
 const active=req.body?.active===undefined?user.active:(req.body.active?1:0);
 if(id===req.auth.id&&!active)return res.status(400).json({error:'You cannot deactivate your own account.'});
 db.prepare(`UPDATE users SET name=?,phone=?,role=?,active=?,password_hash=CASE WHEN ?='' THEN password_hash ELSE ? END WHERE id=?`).run(name,phone,role,active,password,password?bcrypt.hashSync(password,12):'',id);
 res.json({ok:true});
});
export default router;
