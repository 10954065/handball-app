import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { QueryClientProvider } from '@tanstack/react-query'
import { Toaster } from 'sonner'
import { ConfirmProvider } from '@/components/ui/confirm'
import { queryClient } from '@/lib/query'
import { SessionProvider } from '@/lib/session'
import { App } from './App'
import './styles/index.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <ConfirmProvider>
          <App />
          <Toaster theme="dark" position="bottom-right" richColors closeButton />
        </ConfirmProvider>
      </SessionProvider>
    </QueryClientProvider>
  </StrictMode>
)
