'use client';

import { useEffect, useState } from 'react';

/** Persist the dashboard access key in localStorage so it's entered once. */
export function useAccessKey(): [string, (v: string) => void] {
  const [key, setKey] = useState('');
  useEffect(() => {
    setKey(localStorage.getItem('dashboard_key') ?? '');
  }, []);
  const update = (v: string) => {
    setKey(v);
    localStorage.setItem('dashboard_key', v);
  };
  return [key, update];
}
