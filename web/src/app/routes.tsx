import { Navigate, createBrowserRouter } from 'react-router-dom';
import { AppShell } from './AppShell';
import { ActiveCityProvider } from './ActiveCityProvider';
import { RequireAuth } from '@/auth/RequireAuth';
import { LoginPage } from '@/auth/LoginPage';
import { RegisterPage } from '@/auth/RegisterPage';
import { BuilderTab } from '@/features/builder/BuilderTab';
import { ResidentsTab } from '@/features/residents/ResidentsTab';
import { SimulationTab } from '@/features/simulation/SimulationTab';
import { ProposalsTab } from '@/features/proposals/ProposalsTab';

/**
 * The four tabs from the proposal doc, behind the auth guard.
 * Add nested routes (e.g. /proposals/:proposalId) under the tab that owns them.
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
      { index: true, element: <Navigate to="/city" replace /> },
      { path: 'city', element: <BuilderTab /> },
      { path: 'residents', element: <ResidentsTab /> },
      { path: 'simulation', element: <SimulationTab /> },
      { path: 'proposals', element: <ProposalsTab /> },
    ],
  },
  { path: '*', element: <Navigate to="/city" replace /> },
]);
