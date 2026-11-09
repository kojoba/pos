import { useEffect, useState } from 'react';
import { AlertTriangle, ArrowDownToLine, Boxes, Check, ClipboardList, PackageCheck, Pencil, Plus, Search, SlidersHorizontal, Trash2, Warehouse as WarehouseIcon, X } from 'lucide-react';
import { api, dateTime, money } from '../lib/api';
import PageHeader from '../components/PageHeader';
import StatCard from '../components/StatCard';
import Modal from '../components/Modal';
import EmptyState from '../components/EmptyState';

function ProductForm({ initial, onClose, onSave }) {
  const [form,setForm]=useState(initial||{name:'',category:'Food',price:'',stock:'0',reorderLevel:'10'});
  const [error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event){event.preventDefault();setBusy(true);setError('');try{await onSave({...form,price:Number(form.price),stock:Number(form.stock),reorderLevel:Number(form.reorderLevel)});onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Modal title={initial?'Edit product':'Add a menu product'} onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <label>Product name<input required value={form.name} onChange={e=>setForm({...form,name:e.target.value})}/></label>
    <div className="form-columns"><label>Category<input required value={form.category} onChange={e=>setForm({...form,category:e.target.value})}/></label><label>Price (GH₵)<input required type="number" min="0" step="0.01" value={form.price} onChange={e=>setForm({...form,price:e.target.value})}/></label></div>
    {!initial&&<label>Opening restaurant stock<input required type="number" min="0" step="1" value={form.stock} onChange={e=>setForm({...form,stock:e.target.value})}/><small className="field-hint">This adds the opening quantity to the restaurant. Warehouse quantities are entered separately.</small></label>}
    <label>Restaurant reorder level<input required type="number" min="0" step="1" value={form.reorderLevel} onChange={e=>setForm({...form,reorderLevel:e.target.value})}/></label>
    {error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?'Saving…':'Save product'}</button></div>
  </form></Modal>;
}

function AdjustmentModal({ product, onClose, onSave, location='warehouse' }) {
  const isWarehouse=location==='warehouse';
  const [quantity,setQuantity]=useState(''),[note,setNote]=useState(isWarehouse?'Opening warehouse stock':'Restaurant stock adjustment'),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event){event.preventDefault();setBusy(true);setError('');try{await onSave(Number(quantity),note);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Modal title={`Update ${isWarehouse?'warehouse':'restaurant'} stock`} onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <div className="adjust-stock-summary"><span>{product.name}</span><strong>{isWarehouse?product.warehouseStock:product.onHand} <small>on hand</small></strong></div>
    <label>Quantity change<input autoFocus required type="number" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="Positive to receive, negative to remove"/><small className="field-hint">{isWarehouse?'Approved transfer quantities are reserved and cannot be removed.':'Stock reserved for pending mobile money payments cannot be removed.'}</small></label>
    <label>Reason<input required maxLength="200" value={note} onChange={e=>setNote(e.target.value)}/></label>
    {error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?'Saving…':'Save stock change'}</button></div>
  </form></Modal>;
}

function ReceiptModal({ request, onClose, onReceive }) {
  const [quantity,setQuantity]=useState(String(request.quantity)),[note,setNote]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false);
  async function submit(event){event.preventDefault();setBusy(true);setError('');try{await onReceive(Number(quantity),note);onClose()}catch(e){setError(e.message)}finally{setBusy(false)}}
  return <Modal title="Confirm warehouse delivery" onClose={onClose}><form className="stack-form" onSubmit={submit}>
    <div className="adjust-stock-summary"><span>{request.productName} · {request.reference}</span><strong>{request.quantity} <small>sent</small></strong></div>
    <p className="field-hint">Confirm the quantity that physically arrived. The system records the signed-in person who confirms receipt.</p>
    <label>Quantity received<input autoFocus required type="number" min="0" max={request.quantity} step="1" value={quantity} onChange={e=>setQuantity(e.target.value)}/></label>
    <label>Receipt note{Number(quantity)!==request.quantity&&<b className="required-mark">Required for a difference</b>}<textarea rows="3" maxLength="300" value={note} onChange={e=>setNote(e.target.value)} placeholder="Explain any missing or damaged items"/></label>
    {error&&<div className="form-error">{error}</div>}<div className="modal-actions"><button type="button" className="button button-secondary" onClick={onClose}>Cancel</button><button className="button button-primary" disabled={busy}>{busy?'Recording…':'Confirm received'}</button></div>
  </form></Modal>;
}

const statusTone = { pending:'badge-warning', approved:'badge-blue', rejected:'badge-neutral', dispatched:'badge-warning', received:'badge-success' };
const statusLabel = { pending:'Awaiting review', approved:'Approved · awaiting dispatch', rejected:'Rejected', dispatched:'In transit', received:'Received' };

export default function Inventory({ user, notify }) {
  const isManager=user.role==='manager';
  const isHeadOffice=isManager&&!user.branchId;
  const [branches,setBranches]=useState([]),[branchId,setBranchId]=useState(user.branchId?String(user.branchId):'');
  const [products,setProducts]=useState([]),[warehouse,setWarehouse]=useState({products:[],recipients:[]});
  const [requests,setRequests]=useState([]),[legacyRequests,setLegacyRequests]=useState([]),[movements,setMovements]=useState([]);
  const [query,setQuery]=useState(''),[tab,setTab]=useState(isManager?'products':'requests');
  const [productModal,setProductModal]=useState(null),[warehouseAdjust,setWarehouseAdjust]=useState(null),[restaurantAdjust,setRestaurantAdjust]=useState(null),[receiptTarget,setReceiptTarget]=useState(null);
  const [error,setError]=useState(''),[busy,setBusy]=useState(false),[request,setRequest]=useState({productId:'',quantity:1,recipientId:String(user.id),note:''});

  async function load(){
    try{
      const [productData,warehouseData,requestData,legacyData]=await Promise.all([
        api(`/products?branchId=${encodeURIComponent(branchId||user.branchId||'')}`),api(`/warehouse?branchId=${encodeURIComponent(branchId||user.branchId||'')}`),api('/warehouse/requests'),api('/stock/requests'),
      ]);
      setProducts(productData.products);setWarehouse(warehouseData);setRequests(requestData.requests);setLegacyRequests(legacyData.requests);setRequest(current=>({...current,recipientId:warehouseData.recipients.some(person=>String(person.id)===String(current.recipientId))?String(current.recipientId):String(warehouseData.recipients[0]?.id||'')}));
      if(isManager){const movementData=await api('/stock/movements');setMovements(movementData.movements)}
      setError('');
    }catch(e){setError(e.message)}
  }
  useEffect(()=>{load()},[branchId]);
  useEffect(()=>{if(!isHeadOffice)return;api('/branches/options').then(({branches:rows})=>{setBranches(rows);if(!branchId&&rows.length)setBranchId(String((rows.find(b=>b.code==='MAIN')||rows[0]).id))}).catch(e=>setError(e.message))},[]);

  const visible=products.filter(p=>p.name.toLowerCase().includes(query.toLowerCase())||p.category.toLowerCase().includes(query.toLowerCase()));
  const pendingCount=requests.filter(r=>r.status==='pending').length;

  async function saveProduct(data){const payload={...data,branchId:Number(branchId)||undefined};if(data.id)await api(`/products/${data.id}`,{method:'PATCH',body:JSON.stringify(payload)});else await api('/products',{method:'POST',body:JSON.stringify(payload)});await load();notify(data.id?'Product updated.':'Product added to the menu.')}
  async function saveWarehouseAdjustment(quantity,note){await api('/warehouse/adjustments',{method:'POST',body:JSON.stringify({productId:warehouseAdjust.id,quantity,note})});await load();notify('Warehouse stock updated.')}
  async function saveRestaurantAdjustment(quantity,note){await api('/stock/adjustments',{method:'POST',body:JSON.stringify({productId:restaurantAdjust.id,quantity,note,branchId:Number(branchId)||undefined})});await load();notify('Restaurant stock updated.')}
  async function submitRequest(event){event.preventDefault();setBusy(true);setError('');try{const result=await api('/warehouse/requests',{method:'POST',body:JSON.stringify(request)});setRequest(current=>({...current,productId:'',quantity:1,note:''}));await load();notify(`Warehouse request ${result.reference} sent for review.`)}catch(e){setError(e.message)}finally{setBusy(false)}}
  async function reviewRequest(id,decision){try{await api(`/warehouse/requests/${id}/review`,{method:'PATCH',body:JSON.stringify({decision})});await load();notify(decision==='approved'?'Request approved. Warehouse stock is reserved until dispatch.':'Request rejected.')}catch(e){notify(e.message,'error')}}
  async function dispatchRequest(id){try{await api(`/warehouse/requests/${id}/dispatch`,{method:'POST'});await load();notify('Items dispatched from the warehouse.')}catch(e){notify(e.message,'error')}}
  async function receiveRequest(receivedQuantity,note){await api(`/warehouse/requests/${receiptTarget.id}/receive`,{method:'POST',body:JSON.stringify({receivedQuantity,note})});await load();notify('Receipt recorded and restaurant stock updated.')}
  async function removeProduct(product){if(!window.confirm(`Remove ${product.name} from the menu? Existing sales will remain in reports.`))return;try{await api(`/products/${product.id}`,{method:'DELETE'});await load();notify('Product removed from the menu.')}catch(e){notify(e.message,'error')}}

  const tabs=isManager
    ? [['products','Products'],['warehouse','Warehouse'],['requests','Requests'],['legacy','Previous requests'],['movements','Movement history']]
    : [['availability','Availability'],['requests','Warehouse requests'],['legacy','Previous requests']];

  return <>
    <PageHeader eyebrow="STOCK CONTROL" title="Inventory" description={isManager?(isHeadOffice?'Manage the shared menu, central warehouse and tracked transfers.':'Review branch transfers and monitor available stock.'):'Check stock, request items and confirm warehouse deliveries.'} action={isHeadOffice?<button className="button button-primary" onClick={()=>setProductModal({})}><Plus size={17}/> Add product</button>:null}/>
    {error&&<div className="inline-error">{error}</div>}
    <section className="stats-grid compact-stats">
      <StatCard label="Menu products" value={products.length} detail="Available in the catalog" icon={Boxes}/>
      <StatCard label="Restaurant low stock" value={products.filter(p=>p.stock<=p.reorderLevel).length} detail="At or below reorder level" icon={AlertTriangle} tone="orange"/>
      <StatCard label="Requests to review" value={pendingCount} detail={isManager?'Waiting for manager review':'Waiting for manager review'} icon={ClipboardList} tone="blue"/>
    </section>
    {isHeadOffice&&<div className="inventory-branch-filter"><label>Stock location<select value={branchId} onChange={e=>setBranchId(e.target.value)}>{branches.map(branch=><option key={branch.id} value={branch.id}>{branch.name}</option>)}</select></label><small>Restaurant quantities and low-stock counts are specific to the selected branch. Warehouse stock is shared.</small></div>}
    <div className="tabs-bar">{tabs.map(([id,label])=><button key={id} onClick={()=>setTab(id)} className={tab===id?'tab-active':''}>{label}{id==='requests'&&pendingCount>0?<em>{pendingCount}</em>:null}</button>)}</div>

    {(tab==='products'||tab==='availability')&&<section className="card table-card"><div className="card-head"><div><span className="eyebrow">RESTAURANT STOCK</span><h2>{isManager?'Products and restaurant stock':'Available products'}</h2></div><div className="search-field small-search"><Search size={16}/><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Search products"/></div></div>
      {visible.length?<div className="table-scroll"><table><thead><tr><th>Product</th><th>Category</th><th>Price</th><th>Restaurant on hand</th><th>Reserved</th><th>Stock status</th>{isManager&&<th className="numeric">Actions</th>}</tr></thead><tbody>{visible.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small className="cell-sub">SKU-{String(p.id).padStart(4,'0')}</small></td><td>{p.category}</td><td>{money(p.price)}</td><td><strong>{p.onHand??p.stock}</strong><small className="cell-sub">Reorder at {p.reorderLevel}</small></td><td>{p.reserved||0}</td><td><span className={`badge ${p.stock<=p.reorderLevel?'badge-warning':'badge-success'}`}><i/>{p.stock<=p.reorderLevel?'Restock soon':'In stock'}</span></td>{isManager&&<td className="numeric action-cell"><button className="table-icon" title="Adjust branch stock" onClick={()=>setRestaurantAdjust(p)}><SlidersHorizontal size={16}/></button>{isHeadOffice&&<><button className="table-icon" title="Edit product" onClick={()=>setProductModal({...p})}><Pencil size={16}/></button><button className="table-icon danger-icon" title="Remove product" onClick={()=>removeProduct(p)}><Trash2 size={16}/></button></>}</td>}</tr>)}</tbody></table></div>:<EmptyState title="No products found" description="Add a product or try another search."/>}
    </section>}

    {tab==='warehouse'&&isManager&&<section className="card table-card"><div className="card-head"><div><span className="eyebrow">CENTRAL STOCK</span><h2>Warehouse inventory</h2></div><span className="round-icon"><WarehouseIcon size={18}/></span></div>
      <div className="warehouse-note">Add your opening warehouse quantities here. Approving a request reserves stock; dispatching it reduces warehouse stock.</div>
      {warehouse.products.length?<div className="table-scroll"><table><thead><tr><th>Product</th><th>Warehouse stock</th><th>Reserved for approved requests</th><th>Available to request</th><th>At restaurant</th>{isHeadOffice&&<th className="numeric">Action</th>}</tr></thead><tbody>{warehouse.products.map(p=><tr key={p.id}><td><strong>{p.name}</strong><small className="cell-sub">{p.category}</small></td><td><strong>{p.warehouseStock}</strong></td><td>{p.warehouseReserved}</td><td>{p.warehouseAvailable}</td><td>{p.restaurantStock}</td>{isHeadOffice&&<td className="numeric"><button className="button button-secondary button-small" onClick={()=>setWarehouseAdjust(p)}><SlidersHorizontal size={14}/> Update stock</button></td>}</tr>)}</tbody></table></div>:<EmptyState title="No menu products" description="Add products first, then record opening warehouse quantities."/>}
    </section>}

    {tab==='requests'&&<>
      <section className="card request-create"><div className="card-head"><div><span className="eyebrow">WAREHOUSE TRANSFER</span><h2>Request items from the warehouse</h2></div><span className="round-icon"><ClipboardList size={18}/></span></div>
        <form onSubmit={submitRequest} className="warehouse-request-form">
          <label>Product<select required value={request.productId} onChange={e=>setRequest({...request,productId:e.target.value})}><option value="">Select product</option>{warehouse.products.map(p=><option value={p.id} key={p.id}>{p.name} · {p.warehouseAvailable} available</option>)}</select></label>
          <label>Quantity<input required type="number" min="1" max="10000" step="1" value={request.quantity} onChange={e=>setRequest({...request,quantity:e.target.value})}/></label>
          <label>Who will receive it?<select required value={request.recipientId} onChange={e=>setRequest({...request,recipientId:e.target.value})}>{warehouse.recipients.map(person=><option key={person.id} value={person.id}>{person.name} · {person.role}</option>)}</select></label>
          <label>Note <span>Optional</span><input maxLength="300" value={request.note} onChange={e=>setRequest({...request,note:e.target.value})} placeholder="Reason or handling note"/></label>
          <button className="button button-primary" disabled={busy}>{busy?'Sending…':'Send request'}</button>
        </form>
      </section>
      <section className="card table-card"><div className="card-head"><div><span className="eyebrow">REQUEST → DISPATCH → RECEIPT</span><h2>{isManager?'Warehouse transfer requests':'Your warehouse requests'}</h2></div></div>
        {requests.length?<div className="table-scroll"><table><thead><tr><th>Request / product</th><th>Requested by</th><th>Receiving person</th><th>Quantity</th><th>Status & audit trail</th>{isManager&&<th className="numeric">Action</th>}{!isManager&&<th>Action</th>}</tr></thead><tbody>{requests.map(r=>{
          const canReceive=r.status==='dispatched'&&(isManager||r.recipientId===user.id);
          return <tr key={r.id}><td><strong>{r.productName}</strong><small className="cell-sub mono">{r.reference}{r.note?` · ${r.note}`:''}</small></td><td>{r.requestedBy}<small className="cell-sub">Requested {dateTime(r.createdAt)}</small></td><td>{r.recipient}<small className="cell-sub">{r.receivedConfirmedBy?`Confirmed by ${r.receivedConfirmedBy}`:'Receipt not confirmed'}</small></td><td>{r.status==='received'?`${r.receivedQuantity} received of ${r.quantity}`:r.quantity}</td><td><span className={`badge ${statusTone[r.status]}`}><i/>{statusLabel[r.status]}</span><small className="cell-sub">{r.approvedBy?`Approved by ${r.approvedBy} · ${dateTime(r.approvedAt)}`:''}{r.dispatchedBy?`${r.approvedBy?' · ':''}Released by ${r.dispatchedBy} · ${dateTime(r.dispatchedAt)}`:''}{r.receivedConfirmedBy?` · Received by ${r.receivedConfirmedBy} · ${dateTime(r.receivedAt)}`:''}{r.receiveNote?` · ${r.receiveNote}`:''}</small></td><td className="numeric action-cell">
            {isManager&&r.status==='pending'&&<><button className="table-icon approve-icon" title="Approve and reserve warehouse stock" onClick={()=>reviewRequest(r.id,'approved')}><Check size={17}/></button><button className="table-icon danger-icon" title="Reject request" onClick={()=>reviewRequest(r.id,'rejected')}><X size={17}/></button></>}
            {isManager&&r.status==='approved'&&<button className="button button-secondary button-small" onClick={()=>dispatchRequest(r.id)}><ArrowDownToLine size={14}/> Dispatch</button>}
            {canReceive&&<button className="button button-primary button-small" onClick={()=>setReceiptTarget(r)}><PackageCheck size={14}/> Confirm receipt</button>}
            {isManager&&r.status==='dispatched'&&!canReceive&&<span className="subtle-meta">Awaiting {r.recipient}</span>}
            {r.status==='received'&&<span className="subtle-meta">{r.receivedAt?dateTime(r.receivedAt):'Complete'}</span>}
            {r.status==='rejected'&&<span className="subtle-meta">{r.rejectedBy?`By ${r.rejectedBy}`:'Closed'}</span>}
          </td></tr>;
        })}</tbody></table></div>:<EmptyState title="No warehouse requests yet" description="Submit a request above. The manager can approve and dispatch it from the warehouse."/>}
      </section>
    </>}

    {tab==='legacy'&&<section className="card table-card"><div className="card-head"><div><span className="eyebrow">OLDER STOCK REQUESTS</span><h2>Previous request history</h2></div></div>
      {legacyRequests.length?<div className="table-scroll"><table><thead><tr><th>Product</th><th>Requested by</th><th>Previously listed receiver</th><th>Quantity</th><th>Status</th><th>Reviewed by</th><th>Submitted</th></tr></thead><tbody>{legacyRequests.map(r=><tr key={r.id}><td><strong>{r.productName}</strong><small className="cell-sub">Request #{r.id}{r.note?` · ${r.note}`:''}</small></td><td>{r.requestedBy}</td><td>{r.receivedBy}</td><td>{r.quantity}</td><td><span className={`badge ${r.status==='approved'?'badge-success':'badge-neutral'}`}>{r.status}</span></td><td>{r.reviewedBy||'—'}</td><td>{dateTime(r.createdAt)}</td></tr>)}</tbody></table></div>:<EmptyState title="No previous requests" description="New requests will use the warehouse approval, dispatch and receipt trail."/>}
    </section>}

    {tab==='movements'&&isManager&&<section className="card table-card"><div className="card-head"><div><span className="eyebrow">AUDIT TRAIL</span><h2>Recent stock movements</h2></div></div>
      {movements.length?<div className="table-scroll"><table><thead><tr><th>When</th><th>Branch</th><th>Product</th><th>Location</th><th>Movement</th><th>Reference / note</th><th>Recorded by</th><th>Receiver</th></tr></thead><tbody>{movements.map(m=><tr key={m.id}><td>{dateTime(m.createdAt||m.created_at)}</td><td>{m.branchName||'Head office / central'}</td><td><strong>{m.product_name}</strong></td><td>{m.location||'restaurant'}</td><td><span className={m.quantity<0?'negative-qty':'positive-qty'}>{m.quantity>0?'+':''}{m.quantity}</span> · {m.movement_type.replaceAll('_',' ')}</td><td className="mono">{m.reference||'—'}</td><td>{m.performed_by}</td><td>{m.received_by||'—'}</td></tr>)}</tbody></table></div>:<EmptyState title="No movements yet" description="Warehouse receipts, dispatches and stock changes will be recorded here."/>}
    </section>}

    {productModal&&<ProductForm initial={productModal.id?productModal:null} onClose={()=>setProductModal(null)} onSave={saveProduct}/>}
    {warehouseAdjust&&<AdjustmentModal product={warehouseAdjust} onClose={()=>setWarehouseAdjust(null)} onSave={saveWarehouseAdjustment}/>}
    {restaurantAdjust&&<AdjustmentModal product={restaurantAdjust} location="restaurant" onClose={()=>setRestaurantAdjust(null)} onSave={saveRestaurantAdjustment}/>}
    {receiptTarget&&<ReceiptModal request={receiptTarget} onClose={()=>setReceiptTarget(null)} onReceive={receiveRequest}/>}
  </>;
}
