import { useEffect,useMemo,useState } from 'react';
import { Search, Users, UserRoundCheck, Coins } from 'lucide-react';
import { api,money,dateTime } from '../lib/api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import EmptyState from '../components/EmptyState';
export default function Customers(){
 const [customers,setCustomers]=useState([]),[query,setQuery]=useState(''),[error,setError]=useState('');
 useEffect(()=>{api('/customers').then(d=>setCustomers(d.customers)).catch(e=>setError(e.message))},[]);
 const filtered=useMemo(()=>customers.filter(c=>`${c.name} ${c.phone}`.toLowerCase().includes(query.toLowerCase())),[customers,query]);
 const revenue=customers.reduce((sum,c)=>sum+c.totalSpent,0),visits=customers.reduce((sum,c)=>sum+c.visits,0);
 return <><PageHeader eyebrow="CUSTOMER DIRECTORY" title="Customers" description="Customer profiles are created when a phone number is added to a sale."/>{error&&<div className="inline-error">{error}</div>}<section className="stats-grid compact-stats"><StatCard label="Customer profiles" value={customers.length} detail="Unique phone numbers" icon={Users}/><StatCard label="Customer revenue" value={money(revenue)} detail="Across recorded visits" icon={Coins} tone="green"/><StatCard label="Total visits" value={visits} detail={customers.length?`${(visits/customers.length).toFixed(1)} average per customer`:'No visits yet'} icon={UserRoundCheck} tone="blue"/></section><section className="card table-card"><div className="card-head"><div><span className="eyebrow">YOUR REGULARS</span><h2>Customer list</h2></div><div className="search-field small-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Find a customer"/></div></div>{filtered.length?<div className="table-scroll"><table><thead><tr><th>Customer</th><th>Phone</th><th>Visits</th><th>Last visit</th><th className="numeric">Total spent</th></tr></thead><tbody>{filtered.map(c=><tr key={c.id}><td><div className="customer-name"><span className="avatar avatar-light">{c.name.slice(0,1).toUpperCase()}</span><strong>{c.name}</strong></div></td><td>{c.phone}</td><td>{c.visits}</td><td>{dateTime(c.lastVisit)}</td><td className="numeric amount-cell">{money(c.totalSpent)}</td></tr>)}</tbody></table></div>:<EmptyState title={query?'No customer found':'No customers yet'} description={query?'Check the name or phone number.':'Add a customer phone to a sale to build the directory.'}/>}</section></>
}
