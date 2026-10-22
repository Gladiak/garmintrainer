import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { applyTheme, cachedProfileTheme } from './lib/palette';
import { ThemeProvider } from './components/ThemeProvider';
import './styles.css';

applyTheme(cachedProfileTheme());

createRoot(document.getElementById('root')).render(<React.StrictMode><ThemeProvider><App /></ThemeProvider></React.StrictMode>);
