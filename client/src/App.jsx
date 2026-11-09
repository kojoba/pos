import { useCallback, useEffect, useState } from 'react';
import { api } from './lib/api';
import { LayoutDashboard, CreditCard, Package, ClipboardList, Users, Bike, UserRoundCog, LogOut, Menu, X, ChefHat, MapPin } from 'lucide-react';
import Toast from './components/Toast';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import POS from './pages/POS';
import Inventory from './pages/Inventory';
import Sales from './pages/Sales';
import Customers from './pages/Customers';
import Deliveries from './pages/Deliveries';
import UsersPage from './pages/Users';
import Feedback from './pages/Feedback';
import Branches from './pages/Branches';

const links = [
 { id:'dashboard', label:'Overview', icon:LayoutDashboard, roles:['manager'] },
 { id:'pos', label:'Point of sale', icon:CreditCard, roles:['manager','worker'] },
 { id:'inventory', label:'Inventory', icon:Package, roles:['manager','worker'] },
 { id:'sales', label:'Sales', icon:ClipboardList, roles:['manager'] },
 { id:'customers', label:'Customers', icon:Users, roles:['manager'] },
 { id:'deliveries', label:'Deliveries', icon:Bike, roles:['manager','rider'] },
 { id:'users', label:'Team accounts', icon:UserRoundCog, roles:['manager'] },
 { id:'branches', label:'Branches', icon:MapPin, roles:['manager'] },
];
const pages = { dashboard:Dashboard, pos:POS, inventory:Inventory, sales:Sales, customers:Customers, deliveries:Deliveries, users:UsersPage, branches:Branches };
export default function App(){
 const [user,setUser]=useState(null),[checking,setChecking]=useState(true),[page,setPage]=useState('dashboard'),[error,setError]=useState(''),[toast,setToast]=useState(null),[mobileOpen,setMobileOpen]=useState(false),[reload,setReload]=useState(0);
 const isPublicFeedback=window.location.pathname==='/feedback';
 useEffect(()=>{api('/auth/me').then(({user})=>{setUser(user);setPage(user.role==='rider'?'deliveries':user.role==='worker'?'pos':'dashboard')}).catch(()=>{}).finally(()=>setChecking(false));},[]);
 const notify=useCallback((message,type='success')=>setToast({message,type}),[]);
 const changed=useCallback(()=>setReload(x=>x+1),[]);
 async function logout(){try{await api('/auth/logout',{method:'POST'})}finally{setUser(null);setPage('dashboard')}}
 if(isPublicFeedback)return <Feedback token={new URLSearchParams(window.location.search).get('token')}/>;
 if(checking)return <div className="loading-screen"><div className="brand-mark"><ChefHat/></div><p>Opening Daddy’s Pizza…</p></div>;
 if(!user)return <Login onLogin={u=>{setUser(u);setPage(u.role==='rider'?'deliveries':u.role==='worker'?'pos':'dashboard')}}/>;
 const allowed=links.filter(item=>item.roles.includes(user.role)&&!(item.id==='customers'&&user.branchId));
 const Page=pages[page]||Dashboard;
 return <div className="app-shell">
   <aside className={`sidebar ${mobileOpen?'sidebar-open':''}`}>
    <div className="brand"><span className="brand-mark"><ChefHat size={21}/></span><div><strong>Daddy’s Pizza</strong><small>Restaurant workspace</small></div><button className="mobile-close icon-button" onClick={()=>setMobileOpen(false)} aria-label="Close navigation"><X/></button></div>
    <div className="sidebar-label">WORKSPACE</div>
    <nav>{allowed.map(({id,label,icon:Icon})=><button key={id} className={`nav-link ${page===id?'nav-active':''}`} onClick={()=>{setPage(id);setMobileOpen(false)}}><Icon size={18}/><span>{label}</span>{id==='inventory'&&user.role==='manager'?<span className="nav-dot"/>:null}</button>)}</nav>
    <div className="sidebar-bottom"><div className="profile-chip"><span className="avatar">{user.name.slice(0,1).toUpperCase()}</span><div className="profile-copy"><strong>{user.name}</strong><small>{user.branchName?`${user.role} · ${user.branchName}`:user.role==='manager'?'Head office manager':user.role}</small></div><button className="logout-button" onClick={logout} aria-label="Sign out" title="Sign out"><LogOut size={17}/></button></div></div>
   </aside>
   {mobileOpen&&<button className="mobile-scrim" aria-label="Close navigation" onClick={()=>setMobileOpen(false)}/>}
   <main className="workspace"><header className="topbar"><button className="mobile-menu icon-button" onClick={()=>setMobileOpen(true)} aria-label="Open navigation"><Menu/></button><div className="breadcrumbs"><span>Daddy’s Pizza</span><b>/</b><strong>{allowed.find(x=>x.id===page)?.label||'Overview'}</strong></div><div className="topbar-meta"><span className="open-status"><i/> Open today</span><span className="topbar-date">{new Date().toLocaleDateString('en-GH',{weekday:'short',day:'numeric',month:'short'})}</span></div></header>
    <div className="page-wrap"><Page key={`${page}-${reload}`} user={user} notify={notify} changed={changed}/></div>
   </main><Toast message={toast?.message} type={toast?.type} onClose={()=>setToast(null)}/>
 </div>
}
