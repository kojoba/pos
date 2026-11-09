import { useEffect,useState } from 'react';
import { Plus,UserRoundCog,ShieldCheck,Search,Pencil,UserX,UserCheck } from 'lucide-react';
import { api,dateTime } from '../lib/api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';
const blank={username:'',name:'',password:'',phone:'',role:'worker',active:true,branchId:''};
function AccountForm({initial,onClose,onSave,branches,isHeadOffice}){
 const creating=!initial?.id;const [form,setForm]=useState(initial||blank),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(e){e.preventDefault();setError('');setBusy(true);try{await onSave(form);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <Modal title={creating?'Create team account':'Edit team account'} onClose={onClose}><form className="stack-form" onSubmit={submit}>
  {creating&&<label>Username<input required minLength="3" maxLength="30" pattern="[a-zA-Z0-9._-]+" value={form.username} onChange={e=>setForm({...form,username:e.target.value})} autoComplete="off"/></label>}
  <label>Full name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
  <div className="form-columns"><label>Role<select value={form.role} onChange={e=>setForm({...form,role:e.target.value})}><option value="worker">Worker</option><option value="rider">Rider</option>{isHeadOffice&&<option value="manager">Manager</option>}</select></label><label>Phone <span>Optional</span><input value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label></div>
  <label>Branch<select required={form.role!=='manager'} disabled={!isHeadOffice&&branches.length===1} value={form.branchId||''} onChange={e=>setForm({...form,branchId:e.target.value})}>{form.role==='manager'&&isHeadOffice&&<option value="">Head office access</option>}{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select><small className="field-hint">Head office managers can view every branch. Other team accounts belong to one branch.</small></label>
  <label>{creating?'Password':'New password'} {!creating&&<span>Leave blank to keep current</span>}<input type="password" required={creating} minLength="8" autoComplete="new-password" value={form.password||''} onChange={e=>setForm({...form,password:e.target.value})} placeholder="At least 8 characters"/></label>
  {!creating&&<label className="checkbox-line"><input type="checkbox" checked={Boolean(form.active)} onChange={e=>setForm({...form,active:e.target.checked})}/> Account is active</label>}
  {error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?'Saving…':creating?'Create account':'Save changes'}</button></div>
 </form></Modal>;
}
export default function UsersPage({notify,changed,user}){
 const [users,setUsers]=useState([]),[branches,setBranches]=useState([]),[query,setQuery]=useState(''),[modal,setModal]=useState(null),[error,setError]=useState('');
 const isHeadOffice=!user?.branchId;
 async function load(){try{const [userData,branchData]=await Promise.all([api('/users'),api('/branches/options')]);setUsers(userData.users);setBranches(branchData.branches)}catch(e){setError(e.message)}}useEffect(()=>{load()},[]);
 async function save(form){const payload={...form,branchId:form.branchId||null};if(form.id)await api(`/users/${form.id}`,{method:'PATCH',body:JSON.stringify(payload)});else await api('/users',{method:'POST',body:JSON.stringify(payload)});await load();changed();notify(form.id?'Account updated.':'Team account created.')}
 const filtered=users.filter(u=>`${u.name} ${u.username} ${u.role} ${u.branchName||''}`.toLowerCase().includes(query.toLowerCase()));
 async function toggleActive(u){try{await api(`/users/${u.id}`,{method:'PATCH',body:JSON.stringify({...u,active:!u.active})});await load();changed();notify(u.active?'Account deactivated.':'Account activated.')}catch(e){notify(e.message,'error')}}
 return <><PageHeader eyebrow="TEAM ACCESS" title="Team accounts" description="Assign staff to branches and control their access." action={<button className="button button-primary" onClick={()=>setModal({...blank,branchId:user?.branchId?String(user.branchId):''})}><Plus size={17}/> Add account</button>}/>{error&&<div className="inline-error">{error}</div>}
  <section className="stats-grid compact-stats"><StatCard label="Team accounts" value={users.length} detail="Across visible branches" icon={UserRoundCog}/><StatCard label="Managers" value={users.filter(u=>u.role==='manager'&&u.active).length} detail="Head office and branch" icon={ShieldCheck} tone="purple"/><StatCard label="Active staff" value={users.filter(u=>u.active).length} detail="Can sign in" icon={UserCheck} tone="green"/></section>
  <section className="card table-card"><div className="card-head"><div><span className="eyebrow">PEOPLE & PERMISSIONS</span><h2>Staff directory</h2></div><div className="search-field small-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search team"/></div></div>{filtered.length?<div className="table-scroll"><table><thead><tr><th>Team member</th><th>Role</th><th>Branch</th><th>Phone</th><th>Access</th><th>Created</th><th className="numeric">Actions</th></tr></thead><tbody>{filtered.map(u=><tr key={u.id}><td><div className="customer-name"><span className="avatar avatar-light">{u.name.slice(0,1).toUpperCase()}</span><div><strong>{u.name}</strong><small className="cell-sub">@{u.username}</small></div></div></td><td><span className={`role-pill role-${u.role}`}>{u.role}</span></td><td>{u.branchName||'Head office'}</td><td>{u.phone||'—'}</td><td><span className={`badge ${u.active?'badge-success':'badge-neutral'}`}><i/>{u.active?'Active':'Inactive'}</span></td><td>{dateTime(u.createdAt)}</td><td className="numeric action-cell"><button className="table-icon" title="Edit account" onClick={()=>setModal({...u,password:''})}><Pencil size={16}/></button><button className={`table-icon ${u.active?'danger-icon':'approve-icon'}`} title={u.active?'Deactivate account':'Activate account'} onClick={()=>toggleActive(u)}>{u.active?<UserX size={16}/>:<UserCheck size={16}/>}</button></td></tr>)}</tbody></table></div>:<EmptyState title="No team members found" description="Add an account or try a different search."/>}</section>
  {modal&&<AccountForm initial={modal.id?modal:null} onClose={()=>setModal(null)} onSave={save} branches={branches} isHeadOffice={isHeadOffice}/>}
 </>;
}
