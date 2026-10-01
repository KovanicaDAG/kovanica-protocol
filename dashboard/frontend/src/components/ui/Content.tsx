import React from 'react';

interface ContentProps {
  children: React.ReactNode;
}

export function Content({ children }: ContentProps) {
  return (
    <main className="flex-1 overflow-auto p-4 lg:p-6">
      <div className="max-w-7xl mx-auto">
        {children}
      </div>
    </main>
  );
}