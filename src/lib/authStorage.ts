import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import { createSessionStorageAdapter } from './authStorageCore';

const browserSessionStorage = createSessionStorageAdapter(() => {
  if (typeof globalThis === 'undefined' || !('sessionStorage' in globalThis)) {
    return undefined;
  }

  return globalThis.sessionStorage;
});

export const authStorage = Platform.OS === 'web'
  ? browserSessionStorage
  : AsyncStorage;
