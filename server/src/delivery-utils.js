export function parseDeliveryDetails(body, phone) {
  const type = String(body?.fulfillmentType || 'pickup').trim().toLowerCase();
  const customerEmail = String(body?.customerEmail || body?.email || '').trim().toLowerCase();
  if (!['pickup', 'delivery'].includes(type)) {
    throw new Error('Choose pickup or delivery for this order.');
  }

  if (type === 'pickup') {
    return {
      fulfillmentType: 'pickup',
      customerEmail,
      deliveryAddress: '',
      deliveryInstructions: '',
      deliveryFeePesewas: 0,
    };
  }

  const deliveryAddress = String(body?.deliveryAddress || '').trim().slice(0, 500);
  const deliveryInstructions = String(body?.deliveryInstructions || '').trim().slice(0, 500);
  const fee = Number(body?.deliveryFee ?? 0);

  if (!deliveryAddress) throw new Error('Enter the delivery address and a landmark.');
  if (!String(phone || '').trim()) throw new Error('A customer phone number is required for delivery.');
  if (!/^\S+@\S+\.\S+$/.test(customerEmail)) throw new Error('Enter a valid email address so the customer can receive the delivery code.');
  if (!Number.isFinite(fee) || fee < 0) throw new Error('Enter a valid delivery fee of GH₵0 or more.');

  return {
    fulfillmentType: 'delivery',
    customerEmail,
    deliveryAddress,
    deliveryInstructions,
    deliveryFeePesewas: Math.round(fee * 100),
  };
}
