import nodemailer from 'nodemailer';

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function createTransport() {
  const user = process.env.GMAIL_USER?.trim();
  const password = process.env.GMAIL_APP_PASSWORD?.replace(/\s/g, '');
  if (!user || !password) {
    throw new Error('Gmail SMTP is not configured. Set GMAIL_USER and GMAIL_APP_PASSWORD in the server environment.');
  }

  const port = Number(process.env.SMTP_PORT || 465);
  if (![465, 587].includes(port)) throw new Error('Set SMTP_PORT to 465 or 587 for Gmail.');

  return nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass: password },
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
}

export async function sendDeliveryCodeEmail({ to, customerName, orderRef, code, feedbackUrl='' }) {
  const user = process.env.GMAIL_USER?.trim();
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || "Daddy's Pizza";
  const name = escapeHtml(customerName || 'Customer');
  const reference = escapeHtml(orderRef);
  const html = `<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#262725;line-height:1.6">
    <h2 style="color:#d96837">Your Daddy’s Pizza delivery is on the way</h2>
    <p>Hello ${name},</p>
    <p>Use this code to confirm that you received order <strong>${reference}</strong>:</p>
    <p style="font-size:32px;font-weight:700;letter-spacing:8px;padding:16px;background:#fff5ee;text-align:center">${code}</p>
    <p>The code expires in 30 minutes. Give it to the rider only when your meal arrives. Do not share it before then.</p>
    <p>Thank you for ordering with Daddy’s Pizza.</p>
    ${feedbackUrl?`<p>After your order arrives, <a href="${escapeHtml(feedbackUrl)}" style="color:#d96837;font-weight:700">share your feedback</a>.</p>`:''}
  </div>`;

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: { name: fromName, address: user },
      to,
      subject: `Your delivery confirmation code for ${orderRef}`,
      html,
      text: `Hello ${customerName || 'Customer'}, your Daddy’s Pizza order ${orderRef} is on the way. Your delivery code is ${code}. It expires in 30 minutes. Give it to the rider only when your meal arrives.${feedbackUrl?` After your order arrives, share your feedback: ${feedbackUrl}`:''}`,
    });
  } catch (error) {
    // Keep credentials and recipient details out of logs and API responses.
    console.error('Gmail SMTP delivery failed:', error.code || error.name || 'SMTP_ERROR');
    if (error.message?.includes('not configured') || error.message?.includes('SMTP_PORT')) throw error;
    throw new Error('Could not send the delivery code email. Check the Gmail SMTP settings and try again.');
  }
}

export function canSendBroadcastEmail() {
  const resendReady = process.env.RESEND_API_KEY?.trim() && process.env.RESEND_FROM_EMAIL?.trim();
  const gmailReady = process.env.GMAIL_USER?.trim() && process.env.GMAIL_APP_PASSWORD?.trim();
  return Boolean(resendReady || gmailReady);
}

function broadcastMarkup({ customerName, message, unsubscribeUrl }) {
  const safeName = escapeHtml(customerName || 'Customer');
  const safeMessage = escapeHtml(message).replace(/\r?\n/g, '<br>');
  return `<div style="font-family:Arial,sans-serif;max-width:600px;margin:auto;color:#282a2c;line-height:1.65">
    <p>Hello ${safeName},</p><p>${safeMessage}</p>
    <hr style="border:0;border-top:1px solid #eee;margin:28px 0 16px">
    <p style="font-size:12px;color:#777">You are receiving this because you opted in to Daddy’s Pizza updates. <a href="${escapeHtml(unsubscribeUrl)}">Unsubscribe</a>.</p>
  </div>`;
}

export async function sendCustomerBroadcastEmail({ to, customerName, subject, message, unsubscribeUrl }) {
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || "Daddy's Pizza";
  const usingResend=Boolean(process.env.RESEND_API_KEY?.trim()&&process.env.RESEND_FROM_EMAIL?.trim());
  const fromEmail = usingResend ? process.env.RESEND_FROM_EMAIL.trim() : process.env.GMAIL_USER?.trim();
  const headers = {
    'List-Unsubscribe': `<${unsubscribeUrl}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  };
  const html = broadcastMarkup({ customerName, message, unsubscribeUrl });
  const text = `Hello ${customerName || 'Customer'},\n\n${message}\n\nYou are receiving this because you opted in to Daddy's Pizza updates. Unsubscribe: ${unsubscribeUrl}`;

  if (usingResend) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: `${fromName} <${fromEmail}>`, to: [to], subject, html, text, headers }),
      signal: AbortSignal.timeout(20000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error?.message || 'Email provider rejected the message.');
    return { messageId: data.id || '' };
  }

  const transporter = createTransport();
  const result = await transporter.sendMail({
    from: { name: fromName, address: fromEmail }, to, subject, html, text, headers,
  });
  return { messageId: result.messageId || '' };
}

export async function sendCustomerBroadcastEmails(messages) {
  const fromName = process.env.EMAIL_FROM_NAME?.trim() || "Daddy's Pizza";
  const usingResend=Boolean(process.env.RESEND_API_KEY?.trim()&&process.env.RESEND_FROM_EMAIL?.trim());
  const fromEmail = usingResend ? process.env.RESEND_FROM_EMAIL.trim() : process.env.GMAIL_USER?.trim();
  const payloads = messages.map(item => ({
    from: `${fromName} <${fromEmail}>`,
    to: [item.to],
    subject: item.subject,
    html: broadcastMarkup(item),
    text: `Hello ${item.customerName || 'Customer'},\n\n${item.message}\n\nYou are receiving this because you opted in to Daddy's Pizza updates. Unsubscribe: ${item.unsubscribeUrl}`,
    headers: { 'List-Unsubscribe': `<${item.unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' },
  }));
  if (usingResend) {
    const response = await fetch('https://api.resend.com/emails/batch', {
      method: 'POST',
      headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY.trim()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payloads),
      signal: AbortSignal.timeout(30000),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.message || data.error?.message || 'Email provider rejected the batch.');
    const results = Array.isArray(data.data) ? data.data : [];
    return messages.map((_,index) => ({ messageId: results[index]?.id || '', error: '' }));
  }

  const transporter = createTransport();
  const results = [];
  for (let offset=0;offset<payloads.length;offset+=5) {
    const group = payloads.slice(offset,offset+5);
    const sent = await Promise.all(group.map(async(payload,index) => {
      try {
        const result = await transporter.sendMail({ from:{name:fromName,address:fromEmail}, ...payload });
        return { messageId:result.messageId||'', error:'' };
      } catch(error) {
        return { messageId:'', error:error.message||'Email could not be sent.' };
      }
    }));
    results.push(...sent);
  }
  return results;
}
