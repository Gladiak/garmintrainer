import React from 'react';
import { createRoot } from 'react-dom/client';
import AccountApp from './components/AccountApp.jsx';
import { applyTheme, getTheme } from './lib/palette';
import { ThemeProvider } from './components/ThemeProvider';
import './styles.css';

applyTheme(getTheme());

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider><AccountApp /></ThemeProvider></React.StrictMode>);
