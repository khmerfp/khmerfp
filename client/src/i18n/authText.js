export const AUTH_TEXT = {
  en: {
    checkingSession: 'Checking your session…',
    signIn: 'Sign in',
    signOut: 'Sign out',
    security: 'Security',
    signInTitle: 'Sign in',
    signInSubtitle: 'Continue with your Google account.',
    googleNotConfigured:
      'Google sign-in is not configured. Set GOOGLE_CLIENT_ID on the server.',
    firstSignInNote:
      'A new account with a zero-balance wallet is created automatically the first time you sign in.',
    signInFailed:
      'Could not sign you in with Google. Please try again.',
    backToPayment: 'Back to payment page',
    securityTitle: 'Security',
    securitySubtitle: 'Protect your account before moving money.',
    telegramRequiredNote:
      'Telegram verification is required before your first deposit.',
    telegramConnected: 'Telegram is connected',
    telegramNotConnected: 'Telegram is not connected',
    connectTelegram: 'Connect Telegram',
    verifyNow: 'Verify now',
    stepUpDone: 'Telegram verified for this session.',
    verifying: 'Verifying…',
    signOutEverywhere: 'Sign out everywhere',
    signOutEverywhereDone: 'All other sessions have been signed out.',
    verifiedAt: 'Verified',
    widgetUnavailable:
      'The Telegram widget could not load. Set TELEGRAM_BOT_USERNAME on the server.',
  },
  km: {
    checkingSession: 'កំពុងពិនិត្យសម័យរបស់អ្នក…',
    signIn: 'ចូល',
    signOut: 'ចាកចេញ',
    security: 'សុវត្ថិភាព',
    signInTitle: 'ចូល',
    signInSubtitle: 'បន្តជាមួយគណនី Google របស់អ្នក។',
    googleNotConfigured:
      'Google មិនទាន់ត្រូវបានកំណត់ទេ។ សូមកំណត់ GOOGLE_CLIENT_ID នៅលើម៉ាស៊ីនមេ។',
    firstSignInNote:
      'គណនីថ្មីជាមួយកាបូបសារប្រាក់សូន្យនឹងត្រូវបង្កើតស្វ័យប្រវត្តិនៅពេលអ្នកចូលដំបូង។',
    signInFailed:
      'មិនអាចចូលជាមួយ Google បានទេ។ សូមព្យាយាមម្តងទៀត។',
    backToPayment: 'ត្រឡប់ទៅទំព័របង់ប្រាក់វិញ',
    securityTitle: 'សុវត្ថិភាព',
    securitySubtitle: 'ការពារគណនីរបស់អ្នកមុនពេលផ្ទេរប្រាក់។',
    telegramRequiredNote:
      'ត្រូវការការផ្ទៀងផ្ទាត់តាម Telegram មុនពេលដាក់ប្រាក់ដំបូង។',
    telegramConnected: 'Telegram បានភ្ជាប់ហើយ',
    telegramNotConnected: 'Telegram មិនទាន់បានភ្ជាប់ទេ',
    connectTelegram: 'ភ្ជាប់ Telegram',
    verifyNow: 'ផ្ទៀងផ្ទាត់ឥឡូវនេះ',
    stepUpDone: 'Telegram បានផ្ទៀងផ្ទាត់សម្រាប់សម័យនេះហើយ។',
    verifying: 'កំពុងផ្ទៀងផ្ទាត់…',
    signOutEverywhere: 'ចាកចេញពីគ្រប់កន្លែង',
    signOutEverywhereDone: 'សម័យផ្សេងទៀតទាំងអស់ត្រូវបានចាកចេញហើយ។',
    verifiedAt: 'បានផ្ទៀងផ្ទាត់',
    widgetUnavailable:
      'វីជុំងត Telegram មិនអាចផ្ទុកបានទេ។ សូមកំណត់ TELEGRAM_BOT_USERNAME នៅលើម៉ាស៊ីនមេ។',
  },
}

export function readStoredLanguage() {
  try {
    return window.localStorage.getItem('angkor_language') === 'km' ? 'km' : 'en'
  } catch {
    return 'en'
  }
}
