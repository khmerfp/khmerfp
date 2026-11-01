import React from 'react';
import { Link } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';

export default function Footer() {
  const { lang } = useApp();

  return (
    <footer className="mt-8 border-t border-[#E4E7EC] dark:border-[#212832] py-6 px-4 text-[11px] text-[#5B6472] dark:text-[#7C8697]">
      <div className="max-w-4xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="flex items-center gap-5">
          <Link to="/about" className="hover:text-[#6C8EF5] transition-colors">
            {lang === 'km' ? 'អំពីយើង' : 'About Us'}
          </Link>
          <Link to="/learn" className="hover:text-[#6C8EF5] transition-colors">
            {lang === 'km' ? 'សិក្សា' : 'Learn'}
          </Link>
        </div>
        <p className="text-[10px]">
          © {new Date().getFullYear()} khmerfp.com ·{' '}
          {lang === 'km'
            ? 'ទីផ្សារទស្សន៍ទាយដំបូងគេរបស់កម្ពុជា'
            : "Cambodia's first prediction market"}
        </p>
      </div>
    </footer>
  );
}