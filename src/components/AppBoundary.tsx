import { Component, type ReactNode } from 'react';
import { MurmurMark } from './MurmurMark';
export class AppBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if(!this.state.failed) return this.props.children;
    return <main className="app-recovery"><MurmurMark size={40}/><h1>No pudimos mostrar esta vista</h1><p>Tus canciones y playlists siguen guardadas en este dispositivo.</p><button className="button primary" onClick={() => { window.location.hash='/home'; window.location.reload(); }}>Volver a Inicio</button></main>;
  }
}
