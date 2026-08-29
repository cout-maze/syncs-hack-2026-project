import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ActiveCityProvider } from './ActiveCityProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/auth/LoginPage';
import { RegisterPage } from '@/auth/RegisterPage';
import { SimulationMode } from '@/features/simulation/SimulationMode';
import { ProposalMode } from '@/features/proposals/ProposalMode';

/**
 * One map, two modes.
 *
 * Both routes render the same city-builder workspace (features/builder) with a different
 * panel beside it, so the map is never rebuilt per mode. There is deliberately no /city
 * route and no /residents route - the map is the workspace, and personas are engine
 * internals rather than a feature. See docs/00-architecture-overview.md.
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
      { index: true, element: <Navigate to="/simulate" replace /> },
      { path: 'simulate', element: <SimulationMode /> },
      { path: 'propose', element: <ProposalMode /> },
      { path: 'propose/:proposalId', element: <ProposalMode /> },
    ],
  },
  { path: '*', element: <Navigate to="/simulate" replace /> },
]);
