import { createHmac, timingSafeEqual } from 'node:crypto';

function feedbackSecret(){
  return process.env.FEEDBACK_TOKEN_SECRET||process.env.JWT_SECRET||'local-development-secret-change-before-deploying';
}

export function createFeedbackToken(orderId){
  const id=Number(orderId);
  const signature=createHmac('sha256',feedbackSecret()).update(`customer-feedback:${id}`).digest('hex');
  return `${id}.${signature}`;
}

export function feedbackOrderId(token){
  const [idText,signature]=String(token||'').split('.');
  const id=Number(idText);
  if(!Number.isInteger(id)||id<1||!signature)return null;
  try{
    const expected=createHmac('sha256',feedbackSecret()).update(`customer-feedback:${id}`).digest('hex');
    const actualBuffer=Buffer.from(signature),expectedBuffer=Buffer.from(expected);
    if(actualBuffer.length!==expectedBuffer.length||!timingSafeEqual(actualBuffer,expectedBuffer))return null;
    return id;
  }catch{return null;}
}

export function feedbackUrl(orderId){
  const isProduction=process.env.NODE_ENV==='production';
  // Keep local receipts on the local Vite app even if PUBLIC_BASE_URL still
  // contains the Render URL copied from production settings.
  const configuredOrigin=isProduction
    ? process.env.PUBLIC_BASE_URL||process.env.CLIENT_ORIGIN
    : process.env.CLIENT_ORIGIN||'http://localhost:5173';
  const origin=String(configuredOrigin||'').replace(/\/$/,'');
  return `${origin}/feedback?token=${encodeURIComponent(createFeedbackToken(orderId))}`;
}
