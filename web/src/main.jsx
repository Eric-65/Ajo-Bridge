import '@fontsource-variable/oxanium';
import '@fontsource-variable/inter-tight';
import '@fontsource/jetbrains-mono/500.css';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/motion.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';

import { Layout } from './components/Layout.jsx';
import { AppProvider } from './lib/store.jsx';
import { CirclePage } from './pages/Circle.jsx';
import { CirclesPage } from './pages/Circles.jsx';
import { CreatePage } from './pages/Create.jsx';
import { LandingPage } from './pages/Landing.jsx';
import { MinePage } from './pages/Mine.jsx';
import { CommunityPage } from './pages/Community.jsx';
import { RefRedirect } from './pages/RefRedirect.jsx';
import { SignInPage } from './pages/SignIn.jsx';
import { CommunityProvider } from './lib/communityStore.jsx';
import { ShareRedirect } from './pages/ShareRedirect.jsx';
import { NotFoundPage } from './pages/NotFound.jsx';
import { SimulatorPage } from './pages/Simulator.jsx';

const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: '/', element: <LandingPage /> },
      { path: '/circles', element: <CirclesPage /> },
      { path: '/create', element: <CreatePage /> },
      { path: '/circle/:id', element: <CirclePage /> },
      { path: '/c/:id', element: <ShareRedirect /> },
      { path: '/mine', element: <MinePage /> },
      { path: '/community', element: <CommunityPage /> },
      { path: '/signin', element: <SignInPage /> },
      { path: '/r/:code', element: <RefRedirect /> },
      { path: '/simulator', element: <SimulatorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <CommunityProvider>
        <RouterProvider router={router} />
      </CommunityProvider>
    </AppProvider>
  </StrictMode>,
);
