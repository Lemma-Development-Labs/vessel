"use client";

import { useSyncExternalStore } from "react";

function subscribe(onStoreChange: () => void) {
  const id = window.setInterval(onStoreChange, 1000);
  return () => window.clearInterval(id);
}

function getNowSec() {
  return Math.floor(Date.now() / 1000);
}

export function useNowSec(): number {
  return useSyncExternalStore(subscribe, getNowSec, () => 0);
}
