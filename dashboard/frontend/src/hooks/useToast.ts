"use client";

import { toast as sonnerToast, Toaster } from "sonner";

export function useToast() {
  return {
    toast: sonnerToast,
    dismiss: sonnerToast.dismiss,
    toasts: [], // sonner doesn't expose toasts directly
  };
}

export { sonnerToast as toast, Toaster };