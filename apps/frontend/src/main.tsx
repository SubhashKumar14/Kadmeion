import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Landing } from './landing.tsx';
import './styles.css';

const mount = document.getElementById('root');
if (!mount) throw new Error('Kadmeion frontend root is missing.');
createRoot(mount).render(<StrictMode><Landing /></StrictMode>);
