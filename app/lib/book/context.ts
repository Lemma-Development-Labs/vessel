"use client";

import { createContext, useContext } from "react";
import type { BookProvider } from "./types";

export const BookContext = createContext<BookProvider | null>(null);

export function useBook(): BookProvider {
  const ctx = useContext(BookContext);
  if (!ctx) throw new Error("useBook must be used under a book provider");
  return ctx;
}
