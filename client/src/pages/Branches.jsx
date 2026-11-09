import { useEffect,useMemo,useState } from 'react';
import { MapPin,Plus,Pencil,RefreshCw,Users,Bike,ReceiptText,Coins } from 'lucide-react';
import { api,money } from '../lib/api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

const blank={name:'',code:'',address:'',phone:'',active:true};
function BranchForm({initial,onClose,onSave}){
 const [form,setForm]=useState(initial||blank),[error,setError]=useState(''),[busy,setBusy]=useState(false);
 async function submit(event){event.preventDefault();setError('');setBusy(true);try{await onSave(form);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
 return <Modal title={initial?.id?'Edit branch':'Add branch'} onClose={onClose}><form className="stack-form" onSubmit={submit}><label>Branch name<input required maxLength="100" value={form.name} onChange={e=>setForm({...form,name:e.target.value})} placeholder="For example, Tema Branch"/></label><label>Branch code<input required maxLength="20" pattern="[a-zA-Z0-9_-]+" value={form.code} onChange={e=>setForm({...form,code:e.target.value.toUpperCase()})} placeholder="TEMA"/></label><label>Address <span>Optional</span><input maxLength="250" value={form.address||''} onChange={e=>setForm({...form,address:e.target.value})}/></label><label>Phone <span>Optional</span><input maxLength="30" value={form.phone||''} onChange={e=>setForm({...form,phone:e.target.value})}/></label>{initial?.id&&<label className="checkbox-line"><input type="checkbox" checked={Boolean(form.active)} onChange={e=>setForm({...form,active:e.target.checked})}/> Branch is active</label>}{error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?'Saving…':initial?.id?'Save branch':'Create branch'}</button></div></form></Modal>;
}

export default function Branches({user,notify,changed}){
 const [branches,setBranches]=useState([]),[isHeadOffice,setIsHeadOffice]=useState(false),[error,setError]=useState(''),[editing,setEditing]=useState(null);
 async function load(){try{const data=await api('/branches');setBranches(data.branches);setIsHeadOffice(data.isHeadOffice);setError('')}catch(e){setError(e.message)}}
 useEffect(()=>{load()},[]);
 async function save(form){const payload={...form,code:form.code.trim().toUpperCase()};if(form.id)await api(`/branches/${form.id}`,{method:'PATCH',body:JSON.stringify(payload)});else await api('/branches',{method:'POST',body:JSON.stringify(payload)});await load();changed();notify(form.id?'Branch updated.':'Branch created.')}
 const totals=useMemo(()=>branches.reduce((sum,b)=>({today:sum.today+b.today,month:sum.month+b.month,staff:sum.staff+b.staffCount,deliveries:sum.deliveries+b.activeDeliveries}),{today:0,month:0,staff:0,deliveries:0}),[branches]);
 return (
  <>
   <PageHeader
    eyebrow={isHeadOffice ? 'HEAD OFFICE' : 'BRANCH OPERATIONS'}
    title={isHeadOffice ? 'Branch monitoring' : `${user?.branchName || 'Branch'} overview`}
    description={isHeadOffice
     ? 'Compare sales and activity across every branch from one place.'
     : 'Review sales and activity for your assigned branch.'}
    action={
     <>
      <button className="button button-secondary" onClick={load}>
       <RefreshCw size={15}/> Refresh
      </button>
      {isHeadOffice && (
       <button className="button button-primary" onClick={() => setEditing({...blank})}>
        <Plus size={16}/> Add branch
       </button>
      )}
     </>
    }
   />
   <div className="branch-stock-note">
    This view tracks sales, staff, deliveries and transfer activity by branch. Menu products are shared, while stock balances are tracked separately for each location.
   </div>
   {error && <div className="inline-error">{error}</div>}
   <section className="stats-grid compact-stats">
    <StatCard label="Branches in view" value={branches.length} detail={isHeadOffice ? 'All locations' : 'Your assigned location'} icon={MapPin}/>
    <StatCard label="Sales today" value={money(totals.today)} detail="Across branches in view" icon={Coins} tone="green"/>
    <StatCard label="Sales this month" value={money(totals.month)} detail="Month to date" icon={ReceiptText} tone="blue"/>
    <StatCard label="Active deliveries" value={totals.deliveries} detail={`${totals.staff} active staff`} icon={Bike} tone="purple"/>
   </section>
   <section className="branch-grid">
    {branches.length ? branches.map(branch => (
     <article className={`card branch-card ${!branch.active ? 'branch-inactive' : ''}`} key={branch.id}>
      <div className="branch-card-top">
       <span className="branch-icon"><MapPin size={18}/></span>
       <span className={`badge ${branch.active ? 'badge-success' : 'badge-neutral'}`}><i/>{branch.active ? 'Active' : 'Inactive'}</span>
       {isHeadOffice && <button className="table-icon" title="Edit branch" onClick={() => setEditing({...branch})}><Pencil size={15}/></button>}
      </div>
      <div className="branch-card-title"><div><h2>{branch.name}</h2><span>{branch.code}{branch.address ? ` · ${branch.address}` : ''}</span></div></div>
      <div className="branch-metrics">
       <div><small>Sales today</small><strong>{money(branch.today)}</strong></div>
       <div><small>Sales this week</small><strong>{money(branch.week)}</strong></div>
       <div><small>Sales this month</small><strong>{money(branch.month)}</strong></div>
       <div><small>Orders today</small><strong>{branch.todayOrders}</strong></div>
       <div><small>Low stock products</small><strong>{branch.lowStock}</strong></div>
       <div><small>Restaurant stock units</small><strong>{branch.stockUnits}</strong></div>
      </div>
      <div className="branch-card-footer">
       <span><Users size={14}/>{branch.staffCount} active staff</span>
       <span><Bike size={14}/>{branch.activeDeliveries} active deliveries</span>
       <span>{branch.cashDueOrders} COD awaiting collection</span>
      </div>
     </article>
    )) : <EmptyState title="No branches to show" description="Create a branch or ask the head office manager to assign your account to one."/>}
   </section>
   {editing && <BranchForm initial={editing.id ? editing : null} onClose={() => setEditing(null)} onSave={save}/>}
  </>
 );
}
