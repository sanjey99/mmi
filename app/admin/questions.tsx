import { useEffect } from 'react';
import { router } from 'expo-router';

/** Compatibility route retained for bookmarks to the retired Question Desk. */
export default function AdminQuestionsRedirect() {
  useEffect(() => { router.replace('/admin/stations'); }, []);
  return null;
}
