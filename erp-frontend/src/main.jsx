import { installChunkReloadGuard } from './utils/chunkReload'
installChunkReloadGuard();

// Retire le boot loader HTML dès que React est prêt à monter
const bootLoader = document.getElementById('boot-loader');
if (bootLoader) bootLoader.remove();

import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import App from './App.jsx'
import Toaster from './components/ui/toaster'
import { AuthProvider } from './context/AuthContext'
import { ThemeProvider } from './context/ThemeContext'
import { SocketProvider } from './context/SocketContext'
import { NotificationProvider } from './context/NotificationContext'
import { UserPreferencesProvider } from './context/UserPreferencesContext'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <ThemeProvider>
        <AuthProvider>
          <SocketProvider>
            <NotificationProvider>
              <UserPreferencesProvider>
                  <App />
                <Toaster />
              </UserPreferencesProvider>
            </NotificationProvider>
          </SocketProvider>
        </AuthProvider>
      </ThemeProvider>
    </BrowserRouter>
  </StrictMode>,
)
