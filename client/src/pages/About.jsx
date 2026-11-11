import React from 'react';
import { useApp } from '../state/AppContext.jsx';

export default function About() {
  const { lang } = useApp();

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 text-[13px] md:text-sm leading-relaxed text-[#0A0E14] dark:text-[#ECEDEF]">
      <div>
        <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B6472] dark:text-[#7C8697] mb-1">
          {lang === 'km' ? 'អំពីយើង' : 'About Us'}
        </p>
        <h1 className="font-display-en text-2xl md:text-3xl" style={{ fontWeight: 700 }}>
          {lang === 'km' ? 'ទីផ្សារទស្សន៍ទាយដំបូងគេរបស់កម្ពុជា' : "Cambodia's first prediction market"}
        </h1>
      </div>

      <p>
        khmerfp.com is Cambodia&apos;s first prediction market. We are built specifically around Khmer culture, representing Khmer
        teams and following Khmer viral trends &mdash; from Kun Khmer bouts to the Cambodian Premier League, from durian
        harvest prices to the daily pump price of petrol in Phnom Penh.
      </p>

      <p>
        Our mission is to give Cambodians a transparent, information-driven way to price what happens next &mdash; the way
        financial markets work everywhere else in the world, but built for the events that actually matter here.
      </p>

      <h2 className="font-display-en text-lg md:text-xl pt-2" style={{ fontWeight: 600 }}>
        A portion of every fee goes to charity
      </h2>
      <p>
        A share of the platform fees we collect is donated to four causes we believe in:
      </p>
      <ul className="list-disc pl-6 space-y-1.5">
        <li>
          <strong>Fighting online scam operations</strong> &mdash; funding digital literacy programs and supporting
          anti-trafficking efforts against the criminal scam centers that target Cambodians and their families.
        </li>
        <li>
          <strong>Supporting Cambodia&apos;s military efforts</strong> &mdash; contributing to the country&apos;s defense and
          humanitarian operations, including support for veterans and the families of service members.
        </li>
        <li>
          <strong>Supporting orphanages</strong> &mdash; providing food, shelter, education, and healthcare for children in
          care across Cambodia.
        </li>
        <li>
          <strong>Higher education for students from impoverished provinces</strong> &mdash; scholarships and stipends that
          let students from rural provinces attend universities in Phnom Penh and beyond, breaking cycles of poverty through
          education.
        </li>
      </ul>

      <h2 className="font-display-en text-lg md:text-xl pt-2" style={{ fontWeight: 600 }}>
        How we operate
      </h2>
      <p>
        We are a small team based in Cambodia. Every market we list has a written resolution rule and a named resolution
        source, published before the market opens. We do not take the other side of your trades &mdash; we operate an order
        book, and our revenue comes from a small fixed transaction fee, not from users losing money.
      </p>
      <p>
        If you spot a market that is unclear, mispriced, or unethical, please tell us. We take that seriously. Every piece
        of feedback helps us build a market Cambodians can actually trust.
      </p>

      <p className="pt-2 text-[11px] text-[#5B6472] dark:text-[#7C8697]">
        Questions? Reach out at <span className="font-mono">hello@khmerfp.com</span>
      </p>
    </div>
  );
}