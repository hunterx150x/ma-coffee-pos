import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { UiProvider } from './components/ui.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <UiProvider>
      <App />
    </UiProvider>
  </React.StrictMode>,
);
