import { createBrowserRouter, Navigate } from 'react-router-dom';
import { MainLayout } from '../layouts/MainLayout';
import { LoginPage } from '../pages/auth/LoginPage';
import { RegisterPage } from '../pages/auth/RegisterPage';
import { DashboardPage } from '../pages/dashboard/DashboardPage';
import { ProductFormPage, ProductListPage } from '../pages/products/ProductPages';
import { StoreListPage } from '../pages/stores/StorePages';
import { TemplateDesignerPage, TemplateFormPage, TemplateListPage } from '../pages/templates/TemplatePages';
import { EslDeviceDetailPage, EslDeviceListPage } from '../pages/esl-devices/EslDevicePages';
import { ApDetailPage, ApListPage } from '../pages/aps/ApPages';
import { TaskListPage } from '../pages/tasks/TaskPages';
import { SettingsPage } from '../pages/settings/SettingsPage';

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  { path: '/register', element: <RegisterPage /> },
  {
    path: '/',
    element: <MainLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" replace /> },
      { path: 'dashboard', element: <DashboardPage /> },
      { path: 'stores', element: <StoreListPage /> },
      { path: 'products', element: <ProductListPage /> },
      { path: 'products/create', element: <ProductFormPage /> },
      { path: 'products/:id', element: <ProductFormPage /> },
      { path: 'products/:id/edit', element: <ProductFormPage /> },
      { path: 'templates', element: <TemplateListPage /> },
      { path: 'templates/create', element: <TemplateFormPage /> },
      { path: 'templates/:id', element: <TemplateDesignerPage /> },
      { path: 'templates/:id/edit', element: <TemplateDesignerPage /> },
      { path: 'templates/:id/designer', element: <TemplateDesignerPage /> },
      { path: 'esl-devices', element: <EslDeviceListPage /> },
      { path: 'esl-devices/:id', element: <EslDeviceDetailPage /> },
      { path: 'aps', element: <ApListPage /> },
      { path: 'aps/:id', element: <ApDetailPage /> },
      { path: 'tasks', element: <TaskListPage /> },
      { path: 'settings', element: <SettingsPage /> },
    ],
  },
]);
