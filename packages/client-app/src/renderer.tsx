import './index.css';
import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import CameraWindow from './CameraWindow';

const container = document.getElementById('root') as HTMLElement;
const isCameraWindow = Boolean(window.isis?.cameraWindow);
createRoot(container).render(
  <React.StrictMode>
    {isCameraWindow ? <CameraWindow /> : <App />}
  </React.StrictMode>,
);
