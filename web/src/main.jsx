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
      { path: '/simulator', element: <SimulatorPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
]);

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <AppProvider>
      <RouterProvider router={router} />
    </AppProvider>
  </StrictMode>,
);
