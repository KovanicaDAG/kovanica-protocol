import { useEffect, useRef } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

type Props = {
  value: string;
  className?: string;
};

export function AddressQr({ value, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !value) return;
    const styles = getComputedStyle(document.documentElement);
    const dark = styles.getPropertyValue("--color-fg").trim() || "#f2f1ee";
    const light = styles.getPropertyValue("--color-surface").trim() || "#121214";
    void QRCode.toCanvas(canvas, value, {
      width: 176,
      margin: 1,
      color: { dark, light },
      errorCorrectionLevel: "M",
    });
  }, [value]);

  return (
    <canvas
      ref={canvasRef}
      width={176}
      height={176}
      className={cn("size-44 rounded-md bg-surface", className)}
      aria-label="QR code for this address"
    />
  );
}
