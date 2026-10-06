import { Area, AreaChart, ResponsiveContainer, YAxis } from "recharts";

/**
 * HeightChart — rolling block-height sparkline.
 * Feeds off the latest head samples; the window grows/shrinks with data.
 * Gold gradient under the line, ticks on the right in subtle mono.
 */
export function HeightChart({
  samples,
}: {
  samples: { at: number; blocks: number }[];
}) {
  const data = samples.map((s) => ({
    ...s,
    label: new Date(s.at).toLocaleTimeString(),
  }));

  return (
    <div className="flex h-full min-h-40 flex-col">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
          <defs>
            <linearGradient id="dashHeightFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#F2A900" stopOpacity={0.28} />
              <stop offset="100%" stopColor="#F2A900" stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <YAxis
            domain={["dataMin - 1", "dataMax + 1"]}
            width={56}
            tick={{ fill: "#6b6b74", fontSize: 10, fontFamily: "IBM Plex Mono, monospace" }}
            tickLine={false}
            axisLine={false}
          />
          <Area
            type="monotone"
            dataKey="blocks"
            stroke="#F2A900"
            strokeWidth={1.6}
            fill="url(#dashHeightFill)"
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
      {data.length > 1 && (
        <p className="mt-1 text-center font-mono text-[10px] text-subtle">
          last {data.length} polls · tip {data[data.length - 1]!.blocks.toLocaleString()}
        </p>
      )}
    </div>
  );
}