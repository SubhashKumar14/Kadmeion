import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing.tsx';
import { TemplateExplorer } from './templates.tsx';
import './styles.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('Kadmeion frontend root is missing.');
const path = window.location.pathname.replace(/\/$/, '') || '/';
const page = path === '/templates' ? <TemplateExplorer/> : <Landing/>;
createRoot(mount).render(<StrictMode>{page}</StrictMode>);
