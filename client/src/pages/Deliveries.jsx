import { useEffect, useState } from 'react';
import { Bike, MapPin, PackageCheck, Phone, ExternalLink, Mail, ShieldCheck } from 'lucide-react';
import { api, money, dateTime } from '../lib/api';
import PageHeader from '../components/PageHeader';
import EmptyState from '../components/EmptyState';
import Modal from '../components/Modal';

const nextStatus = { assigned: 'picked_up', picked_up: 'en_route', en_route: 'delivered' };
const statusLabel = { assigned: 'Assigned', picked_up: 'Picked up', en_route: 'On the way', delivered: 'Delivered' };

export default function Deliveries({ user, notify, changed }) {
  const manager = user.role === 'manager';
  const [deliveries, setDeliveries] = useState([]);
  const [available, setAvailable] = useState([]);
  const [riders, setRiders] = useState([]);
  const [orderId, setOrderId] = useState('');
  const [riderId, setRiderId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifyTarget, setVerifyTarget] = useState(null);
  const [verificationCode, setVerificationCode] = useState('');
  const [cashCollected, setCashCollected] = useState(false);
  const [verifyError, setVerifyError] = useState('');
  const [verifyBusy, setVerifyBusy] = useState(false);
  const [resendBusy, setResendBusy] = useState(false);
  const [emailTarget, setEmailTarget] = useState(null);
  const [customerEmail, setCustomerEmail] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);
  const [emailError, setEmailError] = useState('');

  async function load() {
    try {
      const deliveryData = await api('/deliveries');
      setDeliveries(deliveryData.deliveries);
      if (manager) {
        const dispatchData = await api('/deliveries/available-orders');
        setAvailable(dispatchData.orders);
        setRiders(dispatchData.riders);
        setOrderId(current => dispatchData.orders.some(order => String(order.id) === current)
          ? current : String(dispatchData.orders[0]?.id || ''));
        setRiderId(current => dispatchData.riders.some(rider => String(rider.id) === current)
          ? current : String(dispatchData.riders[0]?.id || ''));
      }
    } catch (requestError) {
      setError(requestError.message);
    }
  }

  useEffect(() => { load(); }, []);

  async function assign(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/deliveries', {
        method: 'POST',
        body: JSON.stringify({ orderId: Number(orderId), riderId: Number(riderId) }),
      });
      await load();
      changed();
      notify('Rider assigned to the order.');
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  }

  async function update(delivery, status) {
    if (status === 'delivered') {
      setVerifyTarget(delivery);
      setVerificationCode('');
      setCashCollected(false);
      setVerifyError('');
      return;
    }
    try {
      const result = await api(`/deliveries/${delivery.id}/status`, { method: 'PATCH', body: JSON.stringify({ status }) });
      await load();
      changed();
      notify(result.verificationEmailSent ? 'Delivery started. A verification code was emailed to the customer.' : 'Delivery status updated.');
    } catch (requestError) {
      notify(requestError.message, 'error');
    }
  }

  async function completeDelivery(event) {
    event.preventDefault();
    if (!verifyTarget) return;
    setVerifyBusy(true);
    setVerifyError('');
    try {
      const collectCash = verifyTarget.paymentMethod === 'Cash on delivery' && verifyTarget.orderStatus === 'due';
      await api(`/deliveries/${verifyTarget.id}/status`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'delivered', verificationCode, cashCollected: collectCash && cashCollected }),
      });
      const wasCod = collectCash;
      setVerifyTarget(null);
      await load();
      changed();
      notify(wasCod ? 'Delivery verified and cash collection recorded.' : 'Delivery verified and marked delivered.');
    } catch (requestError) {
      setVerifyError(requestError.message);
    } finally {
      setVerifyBusy(false);
    }
  }

  async function resendCode() {
    if (!verifyTarget) return;
    setResendBusy(true);
    setVerifyError('');
    try {
      const result = await api(`/deliveries/${verifyTarget.id}/resend-code`, { method: 'POST' });
      notify(result.message || 'A new code was emailed to the customer.');
    } catch (requestError) {
      setVerifyError(requestError.message);
    } finally {
      setResendBusy(false);
    }
  }

  async function saveCustomerEmail(event) {
    event.preventDefault();
    if (!emailTarget) return;
    setEmailBusy(true);
    setEmailError('');
    try {
      await api(`/deliveries/${emailTarget.id}/customer-email`, {
        method: 'PATCH',
        body: JSON.stringify({ customerEmail: customerEmail.trim() }),
      });
      setEmailTarget(null);
      await load();
      notify('Customer email saved. The rider can now start delivery.');
    } catch (requestError) {
      setEmailError(requestError.message);
    } finally {
      setEmailBusy(false);
    }
  }

  return <>
    <PageHeader
      eyebrow="LAST MILE"
      title={manager ? 'Riders & deliveries' : 'My deliveries'}
      description={manager ? 'Assign delivery orders and follow each drop-off.' : 'Your assigned orders and delivery details.'}
      action={<span className="live-pill"><i/> {deliveries.filter(delivery => delivery.status !== 'delivered').length} ACTIVE</span>}
    />
    {error && <div className="inline-error">{error}</div>}

    {manager && <section className="card assign-card">
      <div className="card-head">
        <div><span className="eyebrow">DISPATCH</span><h2>Assign a rider</h2></div>
        <span className="round-icon"><Bike size={18}/></span>
      </div>
      {available.length && riders.length ? <form className="dispatch-form" onSubmit={assign}>
        <label>Delivery order
          <select value={orderId} onChange={event => setOrderId(event.target.value)}>
            {available.map(order => <option value={order.id} key={order.id}>
              {order.branchName?`${order.branchName} · `:''}{order.ref} · {order.customerName} · {order.deliveryAddress} · {money(order.total)}{order.orderStatus === 'due' ? ' · COD' : ''}
            </option>)}
          </select>
        </label>
        <label>Rider
          <select value={riderId} onChange={event => setRiderId(event.target.value)}>
            {riders.map(rider => <option value={rider.id} key={rider.id}>{rider.name}</option>)}
          </select>
        </label>
        <button className="button button-primary" disabled={busy}>{busy ? 'Assigning…' : 'Assign order'}</button>
      </form> : <div className="dispatch-empty">
        {!available.length ? 'There are no delivery orders waiting for a rider.' : 'Create a rider account in Team accounts to start assigning deliveries.'}
      </div>}
    </section>}

    {deliveries.length ? <section className="delivery-grid">
      {deliveries.map(delivery => {
        const next = nextStatus[delivery.status];
        const canUpdate = delivery.status !== 'delivered' && (manager ? delivery.status === 'en_route' : true);
        const mapUrl = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(delivery.deliveryAddress || '')}`;
        return <article className="delivery-card" key={delivery.id}>
          <div className="delivery-card-top">
            <span className="delivery-ref mono">{delivery.ref}</span>
            <span className={`badge ${delivery.status === 'delivered' ? 'badge-success' : delivery.status === 'en_route' ? 'badge-blue' : 'badge-warning'}`}>
              <i/>{statusLabel[delivery.status]}
            </span>
          </div>

          <div className="delivery-customer">
            <span className="avatar avatar-light">{(delivery.customerName || 'C').slice(0, 1).toUpperCase()}</span>
            <div><strong>{delivery.customerName}</strong><small>{delivery.branchName?`${delivery.branchName} · `:''}{delivery.items || 'Order items unavailable'}</small></div>
            <strong className="delivery-total">{money(delivery.total)}</strong>
          </div>

          {delivery.customerEmailMissing && <div className="delivery-email-warning">
            <span>This order needs the customer’s email before delivery can start.</span>
            {manager
              ? <button className="text-button" onClick={() => { setEmailTarget(delivery); setCustomerEmail(''); setEmailError(''); }}>Add customer email</button>
              : <strong>Ask the manager to add it.</strong>}
          </div>}

          <div className="delivery-rider-info">
            <div className="delivery-info-heading"><MapPin size={15}/><strong>Drop-off address</strong></div>
            <p>{delivery.deliveryAddress || 'No delivery address provided'}</p>
            {delivery.deliveryAddress && <a href={mapUrl} target="_blank" rel="noreferrer"><ExternalLink size={13}/> Open in Maps</a>}
            {delivery.customerPhone && <a href={`tel:${delivery.customerPhone}`}><Phone size={13}/> Call {delivery.customerPhone}</a>}
          </div>

          {delivery.paymentMethod === 'Cash on delivery' && <div className={`cod-collection-note ${delivery.orderStatus === 'paid' ? 'cod-collected' : ''}`}>
            <strong>{delivery.orderStatus === 'paid' ? 'Cash collected' : 'Cash to collect'}</strong>
            <span>{money(delivery.total)}</span>
            {delivery.orderStatus === 'paid' && delivery.cashCollectedBy && <small>Collected by {delivery.cashCollectedBy}{delivery.paidAt ? ` · ${dateTime(delivery.paidAt)}` : ''}</small>}
          </div>}

          {delivery.deliveryInstructions && <div className="delivery-instructions">
            <strong>Rider instructions</strong><p>{delivery.deliveryInstructions}</p>
          </div>}

          <div className="delivery-meta">
            <span><Bike size={14}/>{manager ? delivery.riderName : `Assigned ${dateTime(delivery.assignedAt)}`}</span>
            <span>Delivery fee {money(delivery.deliveryFee)}</span>
          </div>

          <div className="delivery-progress">
            {['assigned', 'picked_up', 'en_route', 'delivered'].map((step, index) =>
              <div key={step} className={`progress-step ${['assigned', 'picked_up', 'en_route', 'delivered'].indexOf(delivery.status) >= index ? 'step-done' : ''}`}>
                <i/><span>{statusLabel[step]}</span>
              </div>)}
          </div>

          {canUpdate && <button className="button button-secondary button-full delivery-action" onClick={() => update(delivery, next)}>
            {next === 'delivered' && delivery.paymentMethod === 'Cash on delivery' && delivery.orderStatus === 'due' ? 'Confirm cash collected & delivered' : manager ? 'Mark delivered' : delivery.status === 'assigned' ? 'Confirm pickup' : delivery.status === 'picked_up' ? 'Start delivery' : 'Mark delivered'}
            <PackageCheck size={16}/>
          </button>}
        </article>;
      })}
    </section> : <section className="card">
      <EmptyState title="No deliveries yet" description={manager ? 'Record a sale as a delivery, then assign it to a rider here.' : 'Your manager will assign deliveries to you here.'}/>
    </section>}
    {verifyTarget && <Modal title="Verify delivery" onClose={() => !verifyBusy && setVerifyTarget(null)}>
      <form className="stack-form" onSubmit={completeDelivery}>
        <div className="delivery-code-prompt"><ShieldCheck size={19}/><p>Ask the customer for the 6-digit code sent to their email. Enter it here to confirm the handoff.</p></div>
        <label>Customer verification code
          <input autoFocus required inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength="6" value={verificationCode} onChange={event => setVerificationCode(event.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="000000" aria-describedby="delivery-code-help"/>
          <small id="delivery-code-help" className="field-hint">The code expires 30 minutes after it is emailed.</small>
        </label>
        {verifyTarget.paymentMethod === 'Cash on delivery' && verifyTarget.orderStatus === 'due' && <label className="checkbox-line"><input type="checkbox" checked={cashCollected} onChange={event => setCashCollected(event.target.checked)}/> I collected {money(verifyTarget.total)} cash from the customer.</label>}
        {verifyError && <div className="form-error">{verifyError}</div>}
        <div className="delivery-code-actions"><button type="button" className="button button-secondary" onClick={resendCode} disabled={resendBusy || verifyBusy}><Mail size={15}/>{resendBusy ? 'Sending…' : 'Resend code'}</button><span>Resend limit: once per minute</span></div>
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setVerifyTarget(null)} disabled={verifyBusy}>Cancel</button><button className="button button-primary" disabled={verifyBusy || verificationCode.length !== 6 || (verifyTarget.paymentMethod === 'Cash on delivery' && verifyTarget.orderStatus === 'due' && !cashCollected)}>{verifyBusy ? 'Verifying…' : 'Verify & mark delivered'}</button></div>
      </form>
    </Modal>}
    {emailTarget && <Modal title="Add customer email" onClose={() => !emailBusy && setEmailTarget(null)}>
      <form className="stack-form" onSubmit={saveCustomerEmail}>
        <p className="field-hint">The customer will receive the delivery confirmation code at this address when the rider starts the trip.</p>
        <label>Customer email
          <input autoFocus required type="email" maxLength="254" value={customerEmail} onChange={event => setCustomerEmail(event.target.value)} placeholder="name@example.com"/>
        </label>
        {emailError && <div className="form-error">{emailError}</div>}
        <div className="modal-actions"><button type="button" className="button button-secondary" onClick={() => setEmailTarget(null)} disabled={emailBusy}>Cancel</button><button className="button button-primary" disabled={emailBusy}>{emailBusy ? 'Saving…' : 'Save email'}</button></div>
      </form>
    </Modal>}
  </>;
}
