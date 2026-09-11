import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import 'antd/dist/reset.css';
import './styles/interaction.css';
import { AppProviders } from './app/providers';
import { router } from './app/router';
ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <RouterProvider router={router} />
  </AppProviders>,
);
