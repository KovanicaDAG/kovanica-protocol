"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Input } from "./input";
import { Label } from "./label";

interface FormFieldProps {
  label: string;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

export function FormField({ label, error, className, children }: FormFieldProps) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70">
        {label}
      </Label>
      {React.isValidElement(children) ? React.cloneElement(children as React.ReactElement<any>, {
        "aria-invalid": !!error,
        "aria-describedby": error ? `${(children as React.ReactElement<any>).props.id}-error` : undefined,
      }) : children}
      {error && (
        <p id={`${(children as React.ReactElement<any>).props.id}-error`} className="text-sm text-destructive" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}