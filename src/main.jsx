import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import CustomerApp from './customer/CustomerApp.jsx';
import { UiProvider } from './components/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UiProvider>
      {/* /order is the public customer page (QR at the counter); everything else is the staff app. */}
      {window.location.pathname.startsWith('/order') ? <CustomerApp /> : <App />}
    </UiProvider>
  </React.StrictMode>,
);
