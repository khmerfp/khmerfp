
import React, { useState } from 'react';
import { X } from 'lucide-react';
import { useApp } from '../state/AppContext.jsx';
import { T } from '../lib/i18n.js';
import { useAuth } from '../auth/authContext.js';
import { GoogleSignIn } from './auth/GoogleSignIn.jsx';
import { FacebookSignIn } from './auth/FacebookSignIn.jsx';
import { EmailPasswordForm } from './auth/EmailPasswordForm.jsx';
import { PhoneOtpForm } from './auth/PhoneOtpForm.jsx';

const METHODS = ['phone', 'email'];

export default function AuthModal({ mode, onModeChange, onClose }) {
  const { lang } = useApp();
  const t = T[lang];

  const {
    googleClientId,
    facebookAppId,
    loginWithGoogle,
    linkGoogleAccount,
    loginWithFacebook,
    linkFacebookAccount,
    loginWithEmail,
    registerWithEmail,
  } = useAuth();

  const [error, setError] = useState('');
  const [method, setMethod] = useState(
    mode === 'register' ? 'email' : 'phone'
  );

  // Google authentication
  const handleGoogleCredential = async (credential) => {
    try {
      setError('');
      await (mode === 'link'
        ? linkGoogleAccount(credential)
        : loginWithGoogle(credential, lang));
      onClose();
    } catch (err) {
      throw err;
    }
  };

  // Facebook authentication: public_profile only
  const handleFacebookAccessToken = async (accessToken) => {
    try {
      setError('');

      await (mode === 'link'
        ? linkFacebookAccount(accessToken)
        : loginWithFacebook(accessToken, lang));

      onClose();
    } catch (err) {
      throw err;
    }
  };

  // Email login
  const handleEmailSignIn = async (payload) => {
    setError('');

    try {
      await loginWithEmail(payload);
      onClose();
    } catch (err) {
      setError(err?.message || t.invalidLogin);
      throw err;
    }
  };

  // Email registration
  const handleEmailRegister = async (payload) => {
    setError('');

    try {
      await registerWithEmail({
        ...payload,
        displayName:
          payload.email?.split('@')[0] || 'User',
      });

      onClose();
    } catch (err) {
      setError(err?.message || t.emailInUse);
      throw err;
    }
  };

  // Phone authentication
  const handlePhoneAuthenticated = () => {
    setError('');
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-950/55 dark:bg-black/75 backdrop-blur-sm p-4 sm:p-6"
      onClick={(e) =>
        e.target === e.currentTarget && onClose()
      }
    >
      <div
        className="modal-in w-full max-w-md max-h-[calc(100vh-2rem)] overflow-y-auto bg-white dark:bg-[#0F141B] text-[#101828] dark:text-[#F2F4F7] border border-[#DCE1E7] dark:border-[#293342] rounded-2xl p-5 sm:p-6 shadow-[0_24px_80px_rgba(15,23,42,0.28)] dark:shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-5 gap-4">
          <div className="min-w-0">
            <h2
              className="text-lg font-display-en"
              style={{ fontWeight: 600 }}
            >
              {mode === 'link'
                ? t.linkSignInMethods
                : method === 'email'
                ? mode === 'register'
                  ? t.createAccount
                  : t.loginTitle
                : t.authWelcome}
            </h2>
          </div>

          <button type="button" onClick={onClose} aria-label="Close" className="flex h-9 w-9 items-center justify-center rounded-full text-[#667085] dark:text-[#98A2B3] transition hover:bg-[#F2F4F7] hover:text-[#101828] dark:hover:bg-[#1A222D] dark:hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#33C7A6]/60">
            <X className="w-5 h-5" />
          </button>
        </div>

        {mode !== 'link' && <>
        {/* Email / Phone selection */}
        <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-[#EAECF0] dark:border-[#202A37] bg-[#F2F4F7] dark:bg-[#090D12] p-1">
          {METHODS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMethod(item);
                setError('');
              }}
              className={`min-h-9 px-3 py-2 rounded-lg text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#33C7A6]/50 ${
                method === item
                  ? 'bg-white dark:bg-[#17202B] text-[#101828] dark:text-white shadow-sm ring-1 ring-black/5 dark:ring-white/5'
                  : 'text-[#667085] dark:text-[#98A2B3] hover:text-[#344054] dark:hover:text-[#D0D5DD]'
              }`}
            >
              {item === 'email' ? t.email : t.phone}
            </button>
          ))}
        </div>

        {/* Email / Phone form */}
        {method === 'email' ? (
          <EmailPasswordForm
            mode={mode}
            onModeChange={(nextMode) => {
              setError('');
              onModeChange(nextMode);
            }}
            onSignIn={handleEmailSignIn}
            onRegister={handleEmailRegister}
          />
        ) : (
          <PhoneOtpForm
            onAuthenticated={handlePhoneAuthenticated}
          />
        )}
        </>}

        {/* Social authentication */}
        {(googleClientId || facebookAppId) && (
          <>
            <div className="relative my-5">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#E4E7EC] dark:border-[#293342]" />
              </div>

              <div className="relative flex justify-center text-xs">
                <span className="px-3 bg-white dark:bg-[#0F141B] text-[11px] uppercase tracking-wider text-[#667085] dark:text-[#98A2B3]">
                  or
                </span>
              </div>
            </div>

            <div className="space-y-3 [&>div]:w-full">
              {googleClientId && (
                <div className="flex justify-center">
                  <GoogleSignIn
                    clientId={googleClientId}
                    onCredential={handleGoogleCredential}
                    locale={lang}
                    label={
                      mode === 'link'
                        ? 'Link Google account'
                        : t.continueGoogle
                    }
                  />
                </div>
              )}

              {facebookAppId && (
                <div className="flex justify-center">
                  <FacebookSignIn
                    appId={facebookAppId}
                    onAccessToken={handleFacebookAccessToken}
                    label={
                      mode === 'link'
                        ? 'Link Facebook account'
                        : t.continueFacebook
                    }
                  />
                </div>
              )}
            </div>
          </>
        )}

        {error && (
          <p className="text-[#E15A4D] text-xs mt-2">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
