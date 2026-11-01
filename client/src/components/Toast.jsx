import { useEffect } from 'react';
import { CheckCircle2, X } from 'lucide-react';
export default function Toast({ message, type = 'success', onClose }) {
  useEffect(() => { if (!message) return; const timer = setTimeout(onClose, 3500); return () => clearTimeout(timer); }, [message, onClose]);
  if (!message) return null;
  return <div className={`toast toast-${type}`} role="status"><CheckCircle2 size={18}/><span>{message}</span><button aria-label="Dismiss notification" onClick={onClose}><X size={16}/></button></div>;
}
