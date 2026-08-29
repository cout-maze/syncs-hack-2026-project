import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ActiveCityProvider } from './ActiveCityProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/auth/LoginPage';
import { RegisterPage } from '@/auth/RegisterPage';
import { ProposalMode } from '@/features/proposals/ProposalMode';

/**
 * One map, floating windows.
 *
 * The map lives in the layout route, so it mounts once and is never rebuilt when a
 * window opens or closes. Only the Proposal window is routed - a proposal is
 * addressable, so `/propose/prp_garden1` deep-links straight to it. The Simulation
 * window is local state in AppShell, because nothing inside it is addressable.
 *
 * See docs/00-architecture-overview.md.
 */
export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: (
      <RequireAuth>
        <ActiveCityProvider>
          <AppShell />
        </ActiveCityProvider>
      </RequireAuth>
    ),
    children: [
      { index: true, element: null },
      { path: 'propose', element: <ProposalMode /> },
      { path: 'propose/:proposalId', element: <ProposalMode /> },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
