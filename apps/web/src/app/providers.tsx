import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, ConfigProvider, message, theme } from 'antd';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import type { PropsWithChildren } from 'react';
import { extractApiErrorMessage } from '../services/http';
import { useAppStore } from './store';

const queryClient = new QueryClient({
  mutationCache: new MutationCache({
    onError: (error, _variables, _context, mutation) => {
      if (mutation.options.onError) return;
      message.error(extractApiErrorMessage(error));
    },
  }),
  queryCache: new QueryCache({
    onError: (error, query) => {
      if (query.meta?.skipGlobalError) return;
      message.error(extractApiErrorMessage(error));
    },
  }),
});

export const AppProviders = ({ children }: PropsWithChildren) => {
  const language = useAppStore((state) => state.language);

  return (
    <ConfigProvider
      locale={language === 'en' ? enUS : zhCN}
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          colorPrimary: '#a64b2a',
          borderRadius: 14,
        },
      }}
    >
      <App>
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      </App>
    </ConfigProvider>
  );
};
