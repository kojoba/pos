import { useEffect,useState } from 'react';
import { Star,ChefHat,CheckCircle2,MessageSquareText } from 'lucide-react';
import { api } from '../lib/api';

function RatingField({label,value,onChange}){
 return <fieldset className="feedback-rating"><legend>{label}</legend><div role="radiogroup" aria-label={label}>{[1,2,3,4,5].map(rating=><button key={rating} type="button" role="radio" aria-checked={value===rating} aria-label={`${rating} star${rating===1?'':'s'}`} className={value>=rating?'rating-selected':''} onClick={()=>onChange(rating)}><Star size={25} fill={value>=rating?'currentColor':'none'}/></button>)}</div><small>{value?`${value} out of 5`: 'Choose a rating'}</small></fieldset>;
}

export default function Feedback({token}){
 const [data,setData]=useState(null),[foodRating,setFoodRating]=useState(0),[serviceRating,setServiceRating]=useState(0),[deliveryRating,setDeliveryRating]=useState(0),[comment,setComment]=useState(''),[loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[error,setError]=useState(''),[success,setSuccess]=useState(false);
 useEffect(()=>{if(!token){setError('This feedback link is missing its order token.');setLoading(false);return}api(`/feedback/${encodeURIComponent(token)}`).then(setData).catch(e=>setError(e.message)).finally(()=>setLoading(false))},[token]);
 async function submit(event){event.preventDefault();setError('');setBusy(true);try{await api(`/feedback/${encodeURIComponent(token)}`,{method:'POST',body:JSON.stringify({foodRating,serviceRating,deliveryRating:data?.order?.fulfillmentType==='delivery'?deliveryRating:null,comment})});setSuccess(true)}catch(e){setError(e.message)}finally{setBusy(false)}}
 const canSubmit=data?.eligible&&foodRating>0&&serviceRating>0&&(data.order.fulfillmentType!=='delivery'||deliveryRating>0);
 return <main className="feedback-screen"><section className="feedback-card"><div className="feedback-brand"><span className="brand-mark"><ChefHat size={22}/></span><div><strong>Daddy’s Pizza</strong><small>Customer feedback</small></div></div>
  {loading?<div className="feedback-message">Loading your feedback form…</div>:error&&!data?<div className="feedback-message feedback-error"><h1>Feedback link unavailable</h1><p>{error}</p></div>:success?<div className="feedback-message feedback-thanks"><span><CheckCircle2 size={31}/></span><h1>Thank you for your feedback!</h1><p>Your comments help us improve the food and service we provide.</p></div>:data?.alreadySubmitted?<div className="feedback-message feedback-thanks"><span><CheckCircle2 size={31}/></span><h1>Feedback received</h1><p>We’ve already received feedback for order <strong>{data.order.reference}</strong>. Thank you.</p></div>:!data?.eligible?<div className="feedback-message"><span className="feedback-pending-icon"><MessageSquareText size={26}/></span><h1>We’re looking forward to hearing from you</h1><p>{data?.message||'This form will be available after your order is complete.'}</p>{data?.order?.reference&&<small>Order {data.order.reference}</small>}</div>:<>
   <div className="feedback-intro"><span className="eyebrow">HOW DID WE DO?</span><h1>Tell us about your order</h1><p>Your feedback goes directly to the restaurant manager.</p><strong>Order {data.order.reference}</strong>{data.order.items?.length>0&&<small>{data.order.items.map(item=>`${item.name} ×${item.quantity}`).join(' · ')}</small>}</div>
   <form className="feedback-form" onSubmit={submit}>
    <RatingField label="Food quality" value={foodRating} onChange={setFoodRating}/>
    <RatingField label="Service" value={serviceRating} onChange={setServiceRating}/>
    {data.order.fulfillmentType==='delivery'&&<RatingField label="Delivery" value={deliveryRating} onChange={setDeliveryRating}/>}
    <label className="feedback-comment">Anything else you’d like us to know? <span>Optional</span><textarea rows="4" maxLength="2000" value={comment} onChange={e=>setComment(e.target.value)} placeholder="Share a comment about your experience…"/></label>
    {error&&<div className="form-error">{error}</div>}
    <button className="button button-primary button-full" disabled={busy||!canSubmit}>{busy?'Submitting…':'Submit feedback'}</button>
   </form>
  </>}
  <footer className="feedback-footer">Daddy’s Pizza · Thank you for choosing us</footer>
 </section></main>;
}
