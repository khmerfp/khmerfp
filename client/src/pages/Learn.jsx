import React, { useEffect } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useApp } from '../state/AppContext.jsx';
import { LEARN_ARTICLES, findArticle } from '../content/learn.js';

export default function Learn() {
  const { lang } = useApp();
  const { slug } = useParams();

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [slug]);

  const article = slug ? findArticle(slug) : null;

  return article ? <Article article={article} lang={lang} /> : <Index lang={lang} />;
}

function Index({ lang }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div>
        <p className="text-[10px] uppercase tracking-[0.12em] text-[#5B6472] dark:text-[#7C8697] mb-1">
          {lang === 'km' ? 'សិក្សា' : 'Learn'}
        </p>
        <h1
          className="font-display-en text-2xl md:text-3xl text-[#0A0E14] dark:text-[#ECEDEF]"
          style={{ fontWeight: 700 }}
        >
          {lang === 'km'
            ? 'សិក្សាអំពីទីផ្សារទស្សន៍ទាយ'
            : 'Learn about prediction markets'}
        </h1>
      </div>

      <div className="space-y-3">
        {LEARN_ARTICLES.map((a) => (
          <Link
            key={a.slug}
            to={`/learn/${a.slug}`}
            className="block w-full text-left rounded-xl border border-[#E4E7EC] dark:border-[#212832] bg-white dark:bg-[#12171F] p-4 hover:border-[#6C8EF5]/60 transition-colors"
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2
                  className="font-display-en text-base md:text-lg text-[#0A0E14] dark:text-[#ECEDEF]"
                  style={{ fontWeight: 600 }}
                >
                  {a.title}
                </h2>
                <p className="text-xs text-[#5B6472] dark:text-[#7C8697] mt-1 leading-relaxed">
                  {a.summary}
                </p>
              </div>
              <span className="text-[10px] text-[#5B6472] dark:text-[#7C8697] shrink-0 font-mono">
                {a.minutes} min
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}

function Article({ article, lang }) {
  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-4 text-[13px] md:text-sm leading-relaxed text-[#0A0E14] dark:text-[#ECEDEF]">
      <Link
        to="/learn"
        className="text-[11px] text-[#6C8EF5] hover:underline mb-2 inline-block"
      >
        ← {lang === 'km' ? 'ត្រឡប់ទៅសិក្សា' : 'Back to Learn'}
      </Link>

      <h1 className="font-display-en text-2xl md:text-3xl" style={{ fontWeight: 700 }}>
        {article.title}
      </h1>
      <p className="text-[11px] text-[#5B6472] dark:text-[#7C8697] font-mono">
        {article.minutes} min read
      </p>

      <div className="space-y-4 pt-2">
        {article.blocks.map((block, i) => (
          <Block key={i} block={block} />
        ))}
      </div>
    </div>
  );
}

function Block({ block }) {
  switch (block.type) {
    case 'p':
      return <p>{block.text}</p>;
    case 'h2':
      return (
        <h2 className="font-display-en text-lg md:text-xl pt-3" style={{ fontWeight: 600 }}>
          {block.text}
        </h2>
      );
    case 'h3':
      return (
        <h3 className="font-display-en text-base md:text-lg pt-2" style={{ fontWeight: 600 }}>
          {block.text}
        </h3>
      );
    case 'ul':
      return (
        <ul className="list-disc pl-6 space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ul>
      );
    case 'ol':
      return (
        <ol className="list-decimal pl-6 space-y-1.5">
          {block.items.map((item, i) => (
            <li key={i}>{item}</li>
          ))}
        </ol>
      );
    case 'formula':
      return (
        <pre className="font-mono text-[12px] md:text-[13px] bg-[#F4F6F8] dark:bg-[#0A0E14] border border-[#E4E7EC] dark:border-[#212832] rounded-lg px-3 py-2.5 overflow-x-auto whitespace-pre">
{block.text}
        </pre>
      );
    case 'callout':
      return (
        <div className="rounded-lg border border-[#6C8EF5]/30 bg-[#6C8EF5]/5 px-3 py-2.5 text-[12px] md:text-[13px]">
          {block.text}
        </div>
      );
    default:
      return null;
  }
}