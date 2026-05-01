import ReactDOM from 'react-dom/client';
import { RouterProvider } from 'react-router-dom';
import 'antd/dist/reset.css';
import './styles/interaction.css';
import { AppProviders } from './app/providers';
import { router } from './app/router';
import { useAppStore } from './app/store';

const storedUser = localStorage.getItem('accessToken')
  ? { id: 'admin-user', username: 'admin', role: 'ADMIN' as const }
  : null;
useAppStore.getState().setUser(storedUser);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <AppProviders>
    <RouterProvider router={router} />
  </AppProviders>,
);
