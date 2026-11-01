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

export async function sendDeliveryCodeEmail({ to, customerName, orderRef, code }) {
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
  </div>`;

  try {
    const transporter = createTransport();
    await transporter.sendMail({
      from: { name: fromName, address: user },
      to,
      subject: `Your delivery confirmation code for ${orderRef}`,
      html,
      text: `Hello ${customerName || 'Customer'}, your Daddy’s Pizza order ${orderRef} is on the way. Your delivery code is ${code}. It expires in 30 minutes. Give it to the rider only when your meal arrives.`,
    });
  } catch (error) {
    // Keep credentials and recipient details out of logs and API responses.
    console.error('Gmail SMTP delivery failed:', error.code || error.name || 'SMTP_ERROR');
    if (error.message?.includes('not configured') || error.message?.includes('SMTP_PORT')) throw error;
    throw new Error('Could not send the delivery code email. Check the Gmail SMTP settings and try again.');
  }
}
