import { createContext, useContext } from 'react';
import type { DraftApi } from './types';

export const AppearanceContext = createContext<DraftApi | null>(null);

export function useAppearance(): DraftApi {
  const value = useContext(AppearanceContext);
  if (!value) throw new Error('useAppearance must be used inside AppearancePage');
  return value;
}