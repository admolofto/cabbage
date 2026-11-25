import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { Object3D } from 'three';
import { App } from './app/App';
import './app/app.css';

// Cabbage is Z up: the floor is the XY plane.
Object3D.DEFAULT_UP.set(0, 0, 1);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
