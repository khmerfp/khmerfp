import React, { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, MessageCircle, Send, Smile, ThumbsUp } from 'lucide-react';
import { useApp } from '../../state/AppContext.jsx';
import { useAuth } from '../../auth/authContext.js';

const API_BASE_URL = import.meta.env.VITE_API_URL?.trim().replace(/\/+$/, '')
  || (import.meta.env.PROD ? 'https://api.khmerfp.com' : '');

function apiUrl(path) {
  return `${API_BASE_URL}${path}`;
}


const EMOJIS = ['😀', '😂', '🥰', '😍', '😎', '🤔', '🙌', '👍', '🔥', '🎉', '❤️', '🙏'];
const REACTIONS = [
  { value: 'like', emoji: '👍', en: 'Like', km: 'ចូលចិត្ត' },
  { value: 'love', emoji: '❤️', en: 'Love', km: 'ស្រឡាញ់' },
  { value: 'care', emoji: '🤗', en: 'Care', km: 'យកចិត្តទុកដាក់' },
  { value: 'haha', emoji: '😂', en: 'Haha', km: 'ហាហា' },
  { value: 'wow', emoji: '😮', en: 'Wow', km: 'អស្ចារ្យ' },
  { value: 'sad', emoji: '😢', en: 'Sad', km: 'សោកសៅ' },
  { value: 'angry', emoji: '😡', en: 'Angry', km: 'ខឹង' },
];

function formatTimestamp(value, lang) {
  return new Date(value).toLocaleString(lang === 'km' ? 'km-KH' : 'en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

async function readApiResponse(response, fallbackMessage) {
  const rawBody = await response.text();
  let result = null;

  if (rawBody) {
    try {
      result = JSON.parse(rawBody);
    } catch {
      // Some proxy and startup errors return plain text or HTML instead of JSON.
    }
  }

  if (!response.ok) {
    throw new Error(result?.message || `${fallbackMessage} (HTTP ${response.status}).`);
  }
  if (!result || typeof result !== 'object') {
    throw new Error(`${fallbackMessage} The server returned an empty or invalid response (HTTP ${response.status}).`);
  }

  return result;
}

function EmojiPicker({ onSelect, open, setOpen, label }) {
  return (
    <div className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label={label}
        aria-expanded={open}
        className="flex h-10 w-10 items-center justify-center rounded-lg border border-[#E4E7EC] dark:border-[#303A47] text-[#5B6472] dark:text-[#A5B4FC]"
      >
        <Smile className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute bottom-full right-0 z-20 mb-2 grid grid-cols-6 gap-1 rounded-xl border border-[#E4E7EC] bg-white p-2 shadow-xl dark:border-[#303A47] dark:bg-[#111821]">
          {EMOJIS.map((emoji) => (
            <button
              type="button"
              key={emoji}
              onClick={() => { onSelect(emoji); setOpen(false); }}
              className="rounded p-1 text-lg hover:bg-[#F4F6F8] dark:hover:bg-[#202833]"
            >
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function AuthorLabel({ user, userId, lang }) {
  return (
    <div className="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-0.5">
      <span className="truncate text-xs font-semibold text-[#1E3A8A] dark:text-[#A5B4FC]">{user}</span>
      <span className="text-[9px] text-[#7C8697]">{lang === 'km' ? 'គណនី' : 'User ID'}: {userId ?? '—'}</span>
    </div>
  );
}

function ReactionButton({ message, lang, disabled, onSelect }) {
  const [open, setOpen] = useState(false);
  const selected = REACTIONS.find((reaction) => reaction.value === message.myReaction);
  const total = Object.values(message.reactionCounts || {}).reduce((sum, count) => sum + Number(count), 0);
  const label = selected
    ? (lang === 'km' ? selected.km : selected.en)
    : (lang === 'km' ? 'ប្រតិកម្ម' : 'React');

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-expanded={open}
        aria-label={`${label} (${total})`}
        className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-medium transition-colors disabled:opacity-50 ${selected ? 'bg-[#6C8EF5]/10 text-[#526FD0] dark:text-[#91A6FF]' : 'text-[#7C8697] hover:bg-[#E9EDF1] dark:hover:bg-[#202833]'}`}
      >
        {selected ? <span aria-hidden="true">{selected.emoji}</span> : <ThumbsUp className="h-3.5 w-3.5" />}
        <span>{label}</span>
        <span>{total}</span>
      </button>
      {open && (
        <div className="absolute bottom-full left-0 z-20 mb-2 flex gap-1 rounded-full border border-[#E4E7EC] bg-white p-1.5 shadow-xl dark:border-[#303A47] dark:bg-[#111821]">
          {REACTIONS.map((reaction) => (
            <button
              type="button"
              key={reaction.value}
              title={lang === 'km' ? reaction.km : reaction.en}
              aria-label={lang === 'km' ? reaction.km : reaction.en}
              aria-pressed={message.myReaction === reaction.value}
              onClick={() => { onSelect(reaction.value); setOpen(false); }}
              className={`rounded-full p-1 text-xl transition-transform hover:scale-125 ${message.myReaction === reaction.value ? 'bg-[#6C8EF5]/15' : ''}`}
            >
              {reaction.emoji}
            </button>
          ))}
          {selected && (
            <button
              type="button"
              title={lang === 'km' ? 'ដកប្រតិកម្ម' : 'Remove reaction'}
              aria-label={lang === 'km' ? 'ដកប្រតិកម្ម' : 'Remove reaction'}
              onClick={() => { onSelect(selected.value); setOpen(false); }}
              className="ml-1 rounded-full px-2 text-xs text-[#7C8697] hover:bg-[#F4F6F8] dark:hover:bg-[#202833]"
            >
              ×
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export default function MessageBoard({ marketId, title, children, onSignIn }) {
  const { lang } = useApp();
  const { user, status } = useAuth();
  const isKhmer = lang === 'km';
  const isSignedIn = status === 'authenticated' && Boolean(user?.id);
  const [messages, setMessages] = useState([]);
  const [postText, setPostText] = useState('');
  const [replyDrafts, setReplyDrafts] = useState({});
  const [replyTo, setReplyTo] = useState(null);
  const [expandedReplies, setExpandedReplies] = useState({});
  const [emojiFor, setEmojiFor] = useState(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(null);
  const [reactingId, setReactingId] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setMessages([]);

    fetch(apiUrl(`/api/markets/${encodeURIComponent(marketId)}/messages`), { signal: controller.signal, credentials: 'include' })
      .then((response) => readApiResponse(response, 'Could not load messages.'))
      .then((result) => {
        return result.messages;
      })
      .then(setMessages)
      .catch((requestError) => {
        if (requestError.name !== 'AbortError') setError(requestError.message);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [marketId]);

  function appendEmoji(emoji, parentId = null) {
    if (parentId === null) {
      setPostText((current) => `${current}${emoji}`);
      return;
    }
    const key = String(parentId);
    setReplyDrafts((current) => ({ ...current, [key]: `${current[key] || ''}${emoji}` }));
  }

  async function submitMessage(event, parentId = null) {
    event.preventDefault();
    const draft = parentId === null ? postText : replyDrafts[String(parentId)] || '';
    const sendKey = parentId === null ? 'post' : String(parentId);
    if (!isSignedIn || !draft.trim() || sending) return;

    setSending(sendKey);
    setError('');
    try {
      const response = await fetch(apiUrl(`/api/markets/${encodeURIComponent(marketId)}/messages`), {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: draft, parentId }),
      });
      const result = await readApiResponse(response, 'Could not send your message.');

      if (parentId === null) {
        setMessages((current) => [...current, result.message]);
        setPostText('');
      } else {
        setMessages((current) => current.map((post) => (
          String(post.id) === String(parentId)
            ? { ...post, replies: [...(post.replies || []), result.message] }
            : post
        )));
        setReplyDrafts((current) => ({ ...current, [String(parentId)]: '' }));
        setReplyTo(null);
      }
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setSending(null);
    }
  }

  async function toggleReaction(message, selectedReaction) {
    if (!isSignedIn) {
      onSignIn?.();
      return;
    }

    const messageId = String(message.id);
    if (reactingId) return;
    setReactingId(messageId);
    setError('');
    try {
      const response = await fetch(
        apiUrl(`/api/markets/${encodeURIComponent(marketId)}/messages/${encodeURIComponent(messageId)}/reaction`),
        {
          method: 'PUT',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            reaction: message.myReaction === selectedReaction ? null : selectedReaction,
          }),
        },
      );
      const result = await readApiResponse(response, 'Could not update reaction.');

      const update = (item) => String(item.id) === messageId
        ? { ...item, myReaction: result.myReaction, reactionCounts: result.reactionCounts }
        : item;
      setMessages((current) => current.map((post) => ({
        ...update(post),
        replies: (post.replies || []).map(update),
      })));
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setReactingId(null);
    }
  }

  function signInPrompt() {
    return (
      <div className="flex items-center justify-between gap-3 rounded-lg bg-[#F4F6F8] px-3 py-2 dark:bg-[#0A0E14]">
        <p className="text-xs text-[#5B6472] dark:text-[#AAB3C0]">
          {status === 'loading'
            ? (isKhmer ? 'កំពុងពិនិត្យគណនី…' : 'Checking your account…')
            : (isKhmer ? 'ចូលគណនីដើម្បីបង្ហោះ ឬឆ្លើយតប។' : 'Sign in to post or reply.')}
        </p>
        {status !== 'loading' && (
          <button type="button" onClick={onSignIn} className="shrink-0 rounded-lg bg-[#33C7A6] px-3 py-2 text-xs font-semibold text-[#07110F]">
            {isKhmer ? 'ចូលគណនី' : 'Sign in'}
          </button>
        )}
      </div>
    );
  }

  function composerForm(parentId = null) {
    const isReply = parentId !== null;
    const key = isReply ? String(parentId) : 'post';
    const draft = isReply ? replyDrafts[key] || '' : postText;
    const setDraft = isReply
      ? (value) => setReplyDrafts((current) => ({ ...current, [key]: value }))
      : setPostText;

    return (
      <form onSubmit={(event) => submitMessage(event, parentId)} className="space-y-2">
        {isReply && (
          <p className="text-[10px] text-[#7C8697]">
            {isKhmer ? 'ឆ្លើយតបទៅកាន់' : 'Replying to'} #{parentId}
          </p>
        )}
        <div className="flex items-end gap-2">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            maxLength={500}
            required
            rows={isReply ? 2 : 3}
            aria-label={isKhmer ? 'សរសេរសារ' : isReply ? 'Write a reply' : 'Write a post'}
            placeholder={isKhmer ? 'សរសេរសាររបស់អ្នក…' : isReply ? 'Write a reply…' : 'Share your thoughts…'}
            className="min-h-10 flex-1 resize-y rounded-lg border border-[#E4E7EC] bg-white px-3 py-2 text-xs outline-none focus:border-[#6C8EF5] dark:border-[#303A47] dark:bg-[#0A0E14]"
          />
          <EmojiPicker
            open={emojiFor === key}
            setOpen={(open) => setEmojiFor(open ? key : null)}
            onSelect={(emoji) => appendEmoji(emoji, parentId)}
            label={isKhmer ? 'បញ្ចូលសញ្ញាអារម្មណ៍' : 'Add emoji'}
          />
          <button
            type="submit"
            disabled={!draft.trim() || sending !== null}
            aria-label={isKhmer ? 'ផ្ញើសារ' : isReply ? 'Send reply' : 'Post message'}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[#6C8EF5] text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {sending === key ? <span className="text-xs">…</span> : <Send className="w-4 h-4" />}
          </button>
        </div>
      </form>
    );
  }

  const totalCount = messages.reduce((total, post) => total + 1 + (post.replies?.length || 0), 0);
  const composer = (
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-3 space-y-3 dark:border-[#212832] dark:bg-[#12171F]">
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-xs font-semibold text-[#0A0E14] dark:text-[#ECEDEF]">
          <MessageCircle className="h-4 w-4 text-[#6C8EF5]" />
          {title || (isKhmer ? 'ការជជែកពិភាក្សា' : 'Market discussion')}
        </h3>
        <span className="text-[10px] text-[#7C8697]">
          {totalCount} {isKhmer ? 'សារ' : totalCount === 1 ? 'message' : 'messages'}
        </span>
      </div>
      {isSignedIn ? (
        <>
          <p className="text-[10px] text-[#7C8697]">
            {user.display_name} · {isKhmer ? 'លេខសម្គាល់គណនី' : 'User ID'}: {user.id}
          </p>
          {composerForm()}
        </>
      ) : signInPrompt()}
      {error && <p role="alert" className="text-[11px] text-[#E15A4D]">{error}</p>}
    </section>
  );

  const discussion = (
    <section className="rounded-xl border border-[#E4E7EC] bg-white p-3 space-y-3 dark:border-[#212832] dark:bg-[#12171F]">
      <h3 className="flex items-center gap-2 text-xs font-semibold text-[#0A0E14] dark:text-[#ECEDEF]">
        <MessageCircle className="h-4 w-4 text-[#6C8EF5]" />
        {isKhmer ? 'សារថ្មីៗ' : 'Recent posts'}
      </h3>
      <div className="max-h-[32rem] space-y-3 overflow-y-auto" aria-live="polite">
        {loading ? (
          <p className="py-3 text-center text-xs text-[#7C8697]">{isKhmer ? 'កំពុងផ្ទុក…' : 'Loading discussion…'}</p>
        ) : messages.length === 0 ? (
          <p className="py-3 text-center text-xs text-[#7C8697]">
            {isKhmer ? 'មិនទាន់មានសារទេ។ បង្ហោះសារដំបូងរបស់អ្នក។' : 'No posts yet. Start the discussion.'}
          </p>
        ) : messages.map((post) => (
          <article key={post.id} className="rounded-lg bg-[#F4F6F8] p-3 dark:bg-[#0A0E14]">
            <div className="flex items-start justify-between gap-2 mb-2">
              <AuthorLabel user={post.user} userId={post.userId} lang={lang} />
              <time className="shrink-0 text-[9px] text-[#7C8697]" dateTime={post.added}>{formatTimestamp(post.added, lang)}</time>
            </div>
            <p className="whitespace-pre-wrap break-words text-xs text-[#333] dark:text-[#ECEDEF]">{post.text}</p>
            <div className="flex items-center gap-1 mt-2">
              <ReactionButton
                message={post}
                lang={lang}
                disabled={reactingId === String(post.id)}
                onSelect={(reaction) => toggleReaction(post, reaction)}
              />
              <button
                type="button"
                onClick={() => isSignedIn ? setReplyTo(replyTo === String(post.id) ? null : String(post.id)) : onSignIn?.()}
                title={isKhmer ? 'ឆ្លើយតប' : 'Reply'}
                aria-label={`${isKhmer ? 'ឆ្លើយតប' : 'Reply'} (${post.replies?.length || 0})`}
                className="inline-flex h-7 min-w-7 items-center justify-center gap-1 rounded-md px-1.5 text-[10px] font-medium text-[#7C8697] hover:bg-[#E9EDF1] dark:hover:bg-[#202833]"
              >
                <MessageCircle className="w-4 h-4" />
                <span>{post.replies?.length || 0}</span>
              </button>
            </div>

            {post.replies?.length > 0 && (
              <div className="mt-2 space-y-2 border-l-2 border-[#DCE3F8] pl-3 dark:border-[#303A47]">
                {(expandedReplies[String(post.id)] ? post.replies : post.replies.slice(0, 1)).map((reply) => (
                  <div key={reply.id} className="rounded-lg bg-white px-3 py-2 dark:bg-[#12171F]">
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <AuthorLabel user={reply.user} userId={reply.userId} lang={lang} />
                      <time className="shrink-0 text-[9px] text-[#7C8697]" dateTime={reply.added}>{formatTimestamp(reply.added, lang)}</time>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-xs text-[#333] dark:text-[#ECEDEF]">{reply.text}</p>
                    <div className="mt-1">
                      <ReactionButton
                        message={reply}
                        lang={lang}
                        disabled={reactingId === String(reply.id)}
                        onSelect={(reaction) => toggleReaction(reply, reaction)}
                      />
                    </div>
                  </div>
                ))}
                {post.replies.length > 1 && (
                  <button
                    type="button"
                    onClick={() => setExpandedReplies((current) => ({
                      ...current,
                      [String(post.id)]: !current[String(post.id)],
                    }))}
                    aria-expanded={Boolean(expandedReplies[String(post.id)])}
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold text-[#526FD0] hover:bg-white dark:text-[#91A6FF] dark:hover:bg-[#12171F]"
                  >
                    {expandedReplies[String(post.id)]
                      ? <><ChevronUp className="h-3.5 w-3.5" /> {isKhmer ? 'បិទការឆ្លើយតប' : 'Hide replies'}</>
                      : <><ChevronDown className="h-3.5 w-3.5" /> {isKhmer ? `មើលការឆ្លើយតប ${post.replies.length - 1} ផ្សេងទៀត` : `Show ${post.replies.length - 1} more ${post.replies.length === 2 ? 'reply' : 'replies'}`}</>}
                  </button>
                )}
              </div>
            )}

            {replyTo === String(post.id) && (
              <div className="mt-3 border-t border-[#E4E7EC] pt-3 dark:border-[#303A47]">
                {isSignedIn ? composerForm(post.id) : signInPrompt()}
              </div>
            )}
          </article>
        ))}
      </div>
    </section>
  );

  return children({ composer, discussion });
}
