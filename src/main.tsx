import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import './styles.css';
import { useStore } from './state/store';
import { analyze, getSession, importBare, importDng, exportActive, renderActive, renderFull, buildProject, relinkProjectImage, finishProjectRelink } from './services/editor';
import { runPipelineBenchmark } from './services/bench';

if (import.meta.env.DEV) {
  (window as unknown as Record<string, unknown>).__rawlab = { useStore, analyze, getSession, importBare, importDng, exportActive, renderActive, renderFull, buildProject, relinkProjectImage, finishProjectRelink, bench: runPipelineBenchmark };
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
