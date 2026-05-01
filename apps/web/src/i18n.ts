import { useAppStore } from './app/store';

export const useI18n = () => {
  const language = useAppStore((state) => state.language);
  const setLanguage = useAppStore((state) => state.setLanguage);

  return {
    language,
    setLanguage,
    tx: (zh: string, en: string) => (language === 'en' ? en : zh),
    isZh: language === 'zh',
    isEn: language === 'en',
  };
};
