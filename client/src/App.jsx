
import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AppProvider, useApp } from './state/AppContext.jsx';

import Home from './pages/Home.jsx';
import RoundsList from './pages/RoundsList.jsx';
import RoundPage from './pages/RoundPage.jsx';
import StaffLogin from './pages/StaffLogin.jsx';
import StaffDashboard from './pages/StaffDashboard.jsx';
import KhmerFPAppIcon from './components/KhmerFPAppIcon.jsx';
import PrivacyPolicy from './pages/PrivacyPolicy.jsx';

function Toast() {
  const { toast } = useApp();

  if (!toast) return null;

  return (
    <div
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[80] px-4 py-2.5 rounded-full text-sm font-medium shadow-lg toast-in ${
        toast.type === 'success'
          ? 'bg-[#33C7A6] text-[#0A0E14]'
          : 'bg-[#E15A4D] text-[#0A0E14]'
      }`}
    >
      {toast.text}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/rounds" element={<RoundsList />} />
        <Route
          path="/round/:marketId/:startAt"
          element={<RoundPage />}
        />
        <Route path="/staff" element={<StaffLogin />} />
        <Route
          path="/staff/dashboard"
          element={<StaffDashboard />}
        />

        <Route
          path="/khmerfp-app-icon"
          element={<KhmerFPAppIcon />}
        />

        <Route
          path="/privacy-policy"
          element={<PrivacyPolicy />}
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>

      <Toast />
    </AppProvider>
  );
}
