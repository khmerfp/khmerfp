import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';

export default function AuthModal({ mode, onModeChange, onClose }) {
  const { lang, users, dispatch, showToast } = useApp();
  const t = T[lang];
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const inputCls = "w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 text-sm outline-none focus:border-[#33C7A6]/60";

  const submit = () => {
    setError('');
    if (mode === 'register') {
      if (!name.trim() || !email.trim() || !phone.trim() || !password) { setError(t.fillAllFields); return; }
      if (users.some((u) => u.email.toLowerCase() === email.toLowerCase())) { setError(t.emailInUse); return; }
      const user = { name: name.trim(), email: email.trim(), phone: phone.trim() };
      dispatch({ type: 'REGISTER_USER', record: { ...user, password }, user });
      showToast('success', lang === 'km' ? `សូមស្វាគមន៍ ${name.trim()}!` : `Welcome, ${name.trim()}!`);
      onClose();
    } else {
      if (!email.trim() || !password) { setError(t.fillAllFields); return; }
      const match = users.find((u) => u.email.toLowerCase() === email.toLowerCase() && u.password === password);
      if (!match) { setError(t.invalidLogin); return; }
      dispatch({ type: 'LOGIN', user: { name: match.name, email: match.email, phone: match.phone } });
      showToast('success', lang === 'km' ? `សូមស្វាគមន៍ត្រឡប់មកវិញ ${match.name}!` : `Welcome back, ${match.name}!`);
      onClose();
    }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-in w-full max-w-sm bg-white dark:bg-[#0F141B] border border-[#E4E7EC] dark:border-[#212832] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display-en text-lg" style={{ fontWeight: 600 }}>{mode === 'register' ? t.registerTitle : t.loginTitle}</h2>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>
        <div className="space-y-2">
          {mode === 'register' && (
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.fullName}</label>
              <input value={name} onChange={(e) => setName(e.target.value)} className={inputCls} />
            </div>
          )}
          <div>
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.email}</label>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className={inputCls + ' font-mono'} />
          </div>
          {mode === 'register' && (
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.phone}</label>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+855 xx xxx xxx" className={inputCls + ' font-mono'} />
            </div>
          )}
          <div>
            <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">{t.password}</label>
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className={inputCls} />
          </div>
        </div>
        {error && <p className="text-[#E15A4D] text-xs mt-2">{error}</p>}
        <button onClick={submit} className="w-full mt-4 py-2.5 rounded-lg font-semibold text-[#0A0E14] bg-[#33C7A6]">
          {mode === 'register' ? t.createAccountBtn : t.logInBtn}
        </button>
        <button onClick={() => onModeChange(mode === 'register' ? 'login' : 'register')} className="w-full mt-2 text-xs text-[#5B6472] dark:text-[#7C8697]">
          {mode === 'register' ? t.switchToLogin : t.switchToRegister}
        </button>
      </div>
    </div>
  );
}