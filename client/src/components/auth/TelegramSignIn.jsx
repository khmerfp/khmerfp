export function TelegramSignIn({ loginUrl, label = 'Continue with Telegram' }) {
  return (
    <a
      href={loginUrl}
      className="flex min-h-10 w-full items-center justify-center gap-2 rounded-lg bg-[#229ED9] px-4 py-2 text-sm font-semibold text-white transition hover:bg-[#168AC0] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#229ED9]/60"
    >
      <svg aria-hidden="true" viewBox="0 0 24 24" className="h-5 w-5 fill-current">
        <path d="M21.6 4.2 18.4 20c-.2 1.1-.8 1.3-1.6.8l-4.8-3.5-2.3 2.2c-.3.3-.5.5-1 .5l.4-4.9 8.9-8c.4-.4-.1-.6-.6-.2L6.4 13.8 1.7 12.3c-1-.3-1-1 .2-1.5L20.2 3.7c.9-.3 1.7.2 1.4.5Z" />
      </svg>
      {label}
    </a>
  )
}
