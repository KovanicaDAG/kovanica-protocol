import * as React from "react";
import { cn } from "@/lib/utils";

// Simple Table component that matches the old API
interface TableProps {
  headers: string[];
  rows: (string | number)[][];
  keyField?: number;
  className?: string;
  emptyMessage?: string;
  /** Render stacked cards below `sm`. Opt out for always-tables. Default true. */
  responsive?: boolean;
}

function cellText(cell: string | number): React.ReactNode {
  return typeof cell === "number" ? cell.toLocaleString() : cell;
}

export function Table({ headers, rows, keyField = 0, className = "", emptyMessage = "No data", responsive = true }: TableProps) {
  if (rows.length === 0) {
    return (
      <div className="table-container">
        <p className="text-muted-foreground text-center py-8">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <>
      {responsive && (
        <div className={`${className} sm:hidden space-y-2`}>
          {rows.map((row, i) => (
            <div key={row[keyField] as string | number} className="card-list-item">
              {row.map((cell, j) => (
                <div key={j} className="card-list-row">
                  <span className="card-list-label">{headers[j] ?? `Column ${j + 1}`}</span>
                  <span className="card-list-value" title={typeof cell === "number" ? String(cell) : cell}>
                    {cellText(cell)}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      )}

      <div
        className={`${responsive ? "hidden sm:block" : ""} table-container table-scroll scrollbar-thin ${className}`}
      >
        <table className="w-full min-w-[640px] md:min-w-[880px]">
          <thead>
            <tr>
              {headers.map((h, i) => (
                <th key={i} className="text-left px-3 py-2 text-muted-foreground font-medium border-b border-border">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row[keyField] as string | number} className="border-b border-border/50 hover:bg-accent/50">
                {row.map((cell, j) => (
                  <td key={j} className="px-3 py-2">
                    <code className="font-mono">{cellText(cell)}</code>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}

// Also re-export the compound Table components
export * from "./compound-table";