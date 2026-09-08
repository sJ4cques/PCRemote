import React from 'react';
import { FirestoreStatus } from '@isisanubis/shared';

const App: React.FC = () => {
  return (
    <div className="app">
      <h1>IsisAnubis Client</h1>
      <p>Equipo que controla (macOS).</p>
      <p className="muted">Fase 0: scaffolding listo.</p>
      <FirestoreStatus />
    </div>
  );
};

export default App;
