import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';

const CREDENTIALS = { user: 'staff', pass: 'khmerfp2026' };

export default function StaffLogin() {
  const navigate = useNavigate();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [error, setError] = useState('');

  const submit = () => {
    setError('');
    if (!user.trim() || !pass) { setError('Please fill in both fields.'); return; }
    if (user.trim() !== CREDENTIALS.user || pass !== CREDENTIALS.pass) {
      setError('Incorrect username or password.');
      return;
    }
    sessionStorage.setItem('staffAuth', '1');
    navigate('/staff/dashboard');
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF] p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <Link to="/" className="inline-flex items-center gap-2">
            <div className="w-9 h-9 rounded-lg bg-[#6C8EF5] flex items-center justify-center">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <span className="font-display-en text-xl" style={{ fontWeight: 600 }}>Staff Portal</span>
          </Link>
        </div>
        <div className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-2xl p-6">
          <h1 className="font-display-en text-lg mb-1" style={{ fontWeight: 600 }}>Sign in</h1>
          <p className="text-xs text-[#5B6472] dark:text-[#7C8697] mb-4">Only authorized research staff can access this.</p>
          <div className="space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Username</label>
              <input value={user} onChange={(e) => setUser(e.target.value)} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 font-mono text-sm outline-none focus:border-[#6C8EF5]/60" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Password</label>
              <input type="password" value={pass} onChange={(e) => setPass(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && submit()} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 font-mono text-sm outline-none focus:border-[#6C8EF5]/60" />
            </div>
          </div>
          {error && <p className="text-[#E15A4D] text-xs mt-2">{error}</p>}
          <button onClick={submit} className="w-full mt-4 py-2.5 rounded-lg font-semibold text-white bg-[#6C8EF5]">Sign in</button>
          <div className="mt-4 pt-3 border-t border-[#E4E7EC] dark:border-[#212832]">
            <p className="text-[10px] text-[#5B6472] dark:text-[#7C8697] mb-1">Demo credentials</p>
            <p className="text-xs font-mono">staff · khmerfp2026</p>
          </div>
        </div>
      </div>
    </div>
  );
}