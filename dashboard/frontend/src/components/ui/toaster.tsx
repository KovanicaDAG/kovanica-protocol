"use client";

import { Toaster as SonnerToaster, type ToasterProps } from "sonner";

type ToasterPropsExtended = ToasterProps & {
  className?: string;
};

export function Toaster({ className, ...props }: ToasterPropsExtended) {
  return (
    <SonnerToaster
      className={className}
      theme="dark"
      toastOptions={{
        classNames: {
          toast: "bg-card border border-border text-card-foreground",
          description: "text-muted-foreground",
          actionButton: "bg-primary text-primary-foreground",
          cancelButton: "bg-muted text-muted-foreground",
        },
      }}
      {...props}
    />
  );
}