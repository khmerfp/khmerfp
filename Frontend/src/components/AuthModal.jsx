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
  const { googleClientId, facebookAppId, loginWithGoogle, loginWithFacebook, loginWithFacebookCode, loginWithEmail, registerWithEmail } = useAuth();
  const [error, setError] = useState('');
  const [method, setMethod] = useState('phone');

  const handleGoogleCredential = async (credential) => {
    try {
      setError('');
      await loginWithGoogle(credential, lang);
      onClose();
    } catch (err) {
      throw err;
    }
  };

  const handleFacebookAccessToken = async (accessToken) => {
    setError('');
    await loginWithFacebook(accessToken, lang);
    onClose();
  };

  const handleFacebookAuthorizationCode = async (code, redirectUri) => {
    setError('');
    await loginWithFacebookCode(code, redirectUri, lang);
    onClose();
  };

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

  const handleEmailRegister = async (payload) => {
    setError('');
    try {
      await registerWithEmail({ ...payload, displayName: payload.email?.split('@')[0] || 'User' });
      onClose();
    } catch (err) {
      setError(err?.message || t.emailInUse);
      throw err;
    }
  };

  const handlePhoneAuthenticated = () => {
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal-in w-full max-w-sm bg-white dark:bg-[#0F141B] border border-[#E4E7EC] dark:border-[#212832] rounded-2xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h2 className="font-display-en text-lg" style={{ fontWeight: 600 }}>{mode === 'register' ? t.createAccount : t.loginTitle}</h2>
          <button onClick={onClose}><X className="w-5 h-5" /></button>
        </div>

        <div className="mb-4 grid grid-cols-2 gap-1 rounded-lg bg-[#F4F6F8] dark:bg-[#0A0E14] p-1">
          {METHODS.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => {
                setMethod(item);
                setError('');
              }}
              className={`py-1.5 rounded-md text-xs font-semibold transition ${
                method === item
                  ? 'bg-white dark:bg-[#0F141B] text-[#0A0E14] dark:text-white shadow-sm'
                  : 'text-[#5B6472] dark:text-[#7C8697]'
              }`}
            >
              {item === 'email' ? t.email : t.phone}
            </button>
          ))}
        </div>

        {method === 'email' ? (
          <EmailPasswordForm onSignIn={handleEmailSignIn} onRegister={handleEmailRegister} />
        ) : (
          <PhoneOtpForm onAuthenticated={handlePhoneAuthenticated} />
        )}
        
        {(googleClientId || facebookAppId) && (
          <>
            <div className="relative my-4">
              <div className="absolute inset-0 flex items-center">
                <div className="w-full border-t border-[#E4E7EC] dark:border-[#212832]"></div>
              </div>
              <div className="relative flex justify-center text-xs">
                <span className="px-2 bg-white dark:bg-[#0F141B] text-[#5B6472] dark:text-[#7C8697]">or</span>
              </div>
            </div>

            <div className="space-y-3">
              {googleClientId && (
                <div className="flex justify-center">
                  <GoogleSignIn
                    clientId={googleClientId}
                    onCredential={handleGoogleCredential}
                    locale={lang}
                    label={mode === 'register' ? 'Sign up with Google' : 'Sign in with Google'}
                  />
                </div>
              )}

              {facebookAppId && (
                <div className="flex justify-center">
                  <FacebookSignIn
                    appId={facebookAppId}
                    onAccessToken={handleFacebookAccessToken}
                    onAuthorizationCode={handleFacebookAuthorizationCode}
                    label={mode === 'register' ? 'Sign up with Facebook' : 'Sign in with Facebook'}
                  />
                </div>
              )}
            </div>
          </>
        )}
        
        {error && <p className="text-[#E15A4D] text-xs mt-2">{error}</p>}
        
        <button onClick={() => onModeChange(mode === 'register' ? 'login' : 'register')} className="w-full mt-3 text-xs text-[#5B6472] dark:text-[#7C8697]">
          {mode === 'register' ? t.switchToLogin : t.switchToRegister}
        </button>
      </div>
    </div>
  );
}