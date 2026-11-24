import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { SessionProvider } from './auth/session';
import { ensureSeeded } from './db/seed';
import './index.css';

const root = ReactDOM.createRoot(document.getElementById('root')!);

ensureSeeded()
  .catch((e) => console.error('Seeding failed', e))
  .finally(() =>
    root.render(
      <React.StrictMode>
        <BrowserRouter>
          <SessionProvider>
            <App />
          </SessionProvider>
        </BrowserRouter>
      </React.StrictMode>,
    ),
  );
