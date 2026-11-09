export function canSendBroadcastSms() {
  return Boolean(process.env.HUBTEL_SMS_CLIENT_ID?.trim()
    && process.env.HUBTEL_SMS_CLIENT_SECRET?.trim()
    && process.env.HUBTEL_SMS_SENDER_ID?.trim());
}

export function hubtelPhone(value) {
  let digits = String(value || '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `233${digits.slice(1)}`;
  return /^233\d{9}$/.test(digits) ? digits : null;
}

export async function sendHubtelBroadcast({ recipients, message }) {
  if (!canSendBroadcastSms()) throw new Error('Hubtel SMS is not configured. Set the Hubtel SMS client ID, secret and approved sender ID.');
  const id = process.env.HUBTEL_SMS_CLIENT_ID.trim();
  const secret = process.env.HUBTEL_SMS_CLIENT_SECRET.trim();
  const credentials = Buffer.from(`${id}:${secret}`).toString('base64');
  const response = await fetch('https://sms.hubtel.com/v1/messages/batch/personalized/send', {
    method: 'POST',
    headers: { Authorization: `Basic ${credentials}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      From: process.env.HUBTEL_SMS_SENDER_ID.trim(),
      personalizedRecipients: recipients.map(item => ({
        To: item.phone,
        Content: `${message.replaceAll('{{name}}', item.name).replaceAll('{{unsubscribe}}', item.unsubscribeUrl)}\nOpt out: ${item.unsubscribeUrl}`,
      })),
    }),
    signal: AbortSignal.timeout(30000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (data.status !== undefined && Number(data.status) !== 0)) {
    throw new Error(data.statusDescription || data.message || 'Hubtel did not accept the SMS broadcast.');
  }
  const results = Array.isArray(data.data) ? data.data : [];
  return {
    batchId: data.batchId || '',
    results: recipients.map(item => {
      const match = results.find(row => String(row.recipient || row.to || '').replace(/\D/g, '') === item.phone);
      return {
        customerId: item.customerId,
        messageId: match?.messageId || '',
        accepted: Boolean(match?.messageId) || Number(data.status) === 0,
        error: match?.statusDescription || '',
      };
    }),
  };
}

export async function getHubtelBatchStatus(batchId) {
  const id = process.env.HUBTEL_SMS_CLIENT_ID?.trim();
  const secret = process.env.HUBTEL_SMS_CLIENT_SECRET?.trim();
  if (!id || !secret) throw new Error('Hubtel SMS is not configured.');
  const credentials = Buffer.from(`${id}:${secret}`).toString('base64');
  const response = await fetch(`https://sms.hubtel.com/v1/messages/batch/${encodeURIComponent(batchId)}`, {
    headers: { Authorization: `Basic ${credentials}` }, signal: AbortSignal.timeout(20000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.message || 'Could not refresh SMS delivery status from Hubtel.');
  return data;
}
