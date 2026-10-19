import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Trash2, LogOut, Lock } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { CATS } from '../lib/constants.js';

export default function StaffDashboard() {
  const navigate = useNavigate();
  const { markets, dispatch, showToast } = useApp();
  const [tab, setTab] = useState('binary');
  const [cat, setCat] = useState('sports');
  const [title, setTitle] = useState('');
  const [titleKm, setTitleKm] = useState('');
  const [sub, setSub] = useState('');
  const [closes, setCloses] = useState('');
  const [yes, setYes] = useState(50);
  const [options, setOptions] = useState([
    { id: 'o1', label: '', yes: 25 },
    { id: 'o2', label: '', yes: 25 },
    { id: 'o3', label: '', yes: 25 },
    { id: 'o4', label: '', yes: 25 },
  ]);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!sessionStorage.getItem('staffAuth')) navigate('/staff');
  }, [navigate]);

  const addOption = () => setOptions([...options, { id: 'o' + Date.now(), label: '', yes: 10 }]);
  const removeOption = (i) => setOptions.length > 2 ? setOptions(options.filter((_, idx) => idx !== i)) : null;

  const publish = () => {
    setError('');
    if (!title.trim()) { setError('Please enter a question.'); return; }
    if (tab === 'multi') {
      const valid = options.filter((o) => o.label.trim());
      if (valid.length < 2) { setError('Add at least 2 options.'); return; }
      const sum = valid.reduce((s, o) => s + Number(o.yes), 0);
      if (sum !== 100) { setError(`Options must sum to 100¢ (currently ${sum}¢).`); return; }
    }
    const id = 'custom-' + Date.now().toString(36);
    const newMarket = tab === 'multi' ? {
      id, cat, type: 'multi', vol: '$0', title: title.trim(), titleKm: (titleKm || title).trim(),
      sub: sub || 'Resolves per staff specification.', subKm: sub || 'សម្រេចតាមការកំណត់របស់បុគ្គលិក។',
      closes: closes || 'TBD', closesKm: closes || 'TBD',
      options: options.filter((o) => o.label.trim()).map((o) => ({ id: o.id, label: o.label.trim(), labelKm: o.label.trim(), yes: Number(o.yes) })),
    } : {
      id, cat, type: 'binary', vol: '$0', title: title.trim(), titleKm: (titleKm || title).trim(),
      sub: sub || 'Resolves per staff specification.', subKm: sub || 'សម្រេចតាមការកំណត់របស់បុគ្គលិក។',
      closes: closes || 'TBD', closesKm: closes || 'TBD', yes: Number(yes),
    };
    newMarket.series = Array.from({ length: 24 }, (_, i) => Math.round(50 + (Math.random() - 0.5) * 20));
    dispatch({ type: 'UPDATE_MARKETS', markets: [...markets, newMarket] });
    showToast('success', 'Published: ' + title.slice(0, 40));
    setTitle(''); setTitleKm(''); setSub(''); setCloses(''); setYes(50);
    setOptions([{ id: 'o1', label: '', yes: 25 }, { id: 'o2', label: '', yes: 25 }, { id: 'o3', label: '', yes: 25 }, { id: 'o4', label: '', yes: 25 }]);
  };

  const logout = () => {
    sessionStorage.removeItem('staffAuth');
    navigate('/staff');
  };

  const custom = markets.filter((m) => m.id.startsWith('custom-'));
  const sum = options.reduce((s, o) => s + (Number(o.yes) || 0), 0);

  return (
    <div className="min-h-screen bg-[#F7F8FA] dark:bg-[#0A0E14] text-[#0A0E14] dark:text-[#ECEDEF]">
      <header className="border-b border-[#E4E7EC] dark:border-[#212832] sticky top-0 bg-[#F7F8FA]/95 dark:bg-[#0A0E14]/95 backdrop-blur z-30">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-[#6C8EF5] flex items-center justify-center">
              <Lock className="w-4 h-4 text-white" />
            </div>
            <div>
              <p className="text-sm" style={{ fontWeight: 600 }}>Staff Dashboard</p>
              <p className="text-[10px] text-[#5B6472] dark:text-[#7C8697] font-mono">staff</p>
            </div>
          </div>
          <button onClick={logout} className="flex items-center gap-1 text-xs text-[#E15A4D]">
            <LogOut className="w-3.5 h-3.5" /> Sign out
          </button>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 py-6 grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-4">
          <div className="flex items-center gap-2">
            <button onClick={() => setTab('binary')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === 'binary' ? 'bg-[#6C8EF5] text-white' : 'text-[#5B6472] dark:text-[#7C8697] border border-[#E4E7EC] dark:border-[#212832]'}`}>Binary</button>
            <button onClick={() => setTab('multi')} className={`px-3 py-1.5 rounded-lg text-sm font-semibold ${tab === 'multi' ? 'bg-[#6C8EF5] text-white' : 'text-[#5B6472] dark:text-[#7C8697] border border-[#E4E7EC] dark:border-[#212832]'}`}>Multi-choice</button>
          </div>
          <div className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-2xl p-4 space-y-3">
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Category</label>
              <select value={cat} onChange={(e) => setCat(e.target.value)} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 text-sm outline-none">
                {CATS.filter((c) => c.id !== 'trending').map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Question (English)</label>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Question (Khmer)</label>
              <input value={titleKm} onChange={(e) => setTitleKm(e.target.value)} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 text-sm outline-none" />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Resolution criteria</label>
              <textarea value={sub} onChange={(e) => setSub(e.target.value)} rows={2} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 text-sm outline-none resize-none" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Closes on</label>
                <input value={closes} onChange={(e) => setCloses(e.target.value)} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2 text-sm" />
              </div>
            </div>

            {tab === 'binary' && (
              <div>
                <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Starting Yes price (¢)</label>
                <input type="number" min="1" max="99" value={yes} onChange={(e) => setYes(Number(e.target.value))} className="w-full mt-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border-2 border-[#33C7A6] rounded-lg px-3 py-2 text-center font-mono text-sm font-semibold text-[#33C7A6]" />
              </div>
            )}

            {tab === 'multi' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] uppercase tracking-[0.1em] text-[#5B6472] dark:text-[#7C8697]">Options</label>
                  <span className={`text-xs font-mono ${sum === 100 ? 'text-[#33C7A6]' : 'text-[#F2B84B]'}`}>Sum: {sum}¢</span>
                </div>
                {options.map((o, i) => (
                  <div key={o.id} className="flex items-center gap-1.5">
                    <input value={o.label} onChange={(e) => setOptions(options.map((x, idx) => idx === i ? { ...x, label: e.target.value } : x))} placeholder="Label" className="flex-1 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-2 py-1.5 text-sm outline-none" />
                    <input type="number" min="1" max="99" value={o.yes} onChange={(e) => setOptions(options.map((x, idx) => idx === i ? { ...x, yes: Number(e.target.value) } : x))} className="w-16 bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-2 py-1.5 text-center font-mono text-sm" />
                    {options.length > 2 && <button onClick={() => removeOption(i)} className="text-[#E15A4D]"><Trash2 className="w-3.5 h-3.5" /></button>}
                  </div>
                ))}
                <button onClick={addOption} className="w-full py-1.5 rounded-lg text-xs font-medium text-[#6C8EF5] border border-dashed border-[#6C8EF5]/40">+ Add option</button>
              </div>
            )}

            {error && <p className="text-[#E15A4D] text-xs">{error}</p>}
            <button onClick={publish} className="w-full py-2.5 rounded-lg font-semibold text-white bg-[#6C8EF5]">Publish to site</button>
          </div>
        </div>

        <div>
          <div className="bg-white dark:bg-[#12171F] border border-[#E4E7EC] dark:border-[#212832] rounded-2xl p-4">
            <div className="flex items-center justify-between mb-2">
              <h3 className="text-sm" style={{ fontWeight: 600 }}>Published markets</h3>
              <span className="text-xs font-mono text-[#5B6472] dark:text-[#7C8697]">{custom.length}</span>
            </div>
            {custom.length === 0 ? (
              <p className="text-xs text-[#5B6472] dark:text-[#7C8697] text-center py-4">No custom markets yet.</p>
            ) : (
              <div className="space-y-1.5 max-h-[500px] overflow-y-auto">
                {custom.slice().reverse().map((m) => (
                  <div key={m.id} className="flex items-start gap-2 p-2 rounded-lg border border-[#E4E7EC] dark:border-[#212832] bg-[#F7F8FA] dark:bg-[#0A0E14]">
                    <div className="flex-1 min-w-0">
                      <p className="text-xs leading-snug line-clamp-2 mb-0.5">{m.title}</p>
                      <p className="text-[10px] font-mono text-[#5B6472] dark:text-[#7C8697]">{m.cat} · {m.type} · {m.closes}</p>
                    </div>
                    <button onClick={() => dispatch({ type: 'UPDATE_MARKETS', markets: markets.filter((x) => x.id !== m.id) })} className="text-[#E15A4D] shrink-0"><Trash2 className="w-3 h-3" /></button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}