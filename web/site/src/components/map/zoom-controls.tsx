import { Minus, Plus, LocateFixed } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type Props = {
  onZoomIn: () => void;
  onZoomOut: () => void;
  onReset: () => void;
  className?: string;
};

export function ZoomControls({ onZoomIn, onZoomOut, onReset, className }: Props) {
  return (
    <div
      className={cn(
        "flex flex-col overflow-hidden rounded-lg bg-surface/90 shadow-border backdrop-blur-sm",
        className,
      )}
    >
      <Button variant="ghost" size="icon" className="size-10 rounded-none text-fg" onClick={onZoomIn} aria-label="Zoom in">
        <Plus className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-10 rounded-none text-fg" onClick={onZoomOut} aria-label="Zoom out">
        <Minus className="size-4" />
      </Button>
      <Button variant="ghost" size="icon" className="size-10 rounded-none text-fg" onClick={onReset} aria-label="Reset view">
        <LocateFixed className="size-4" />
      </Button>
    </div>
  );
}
