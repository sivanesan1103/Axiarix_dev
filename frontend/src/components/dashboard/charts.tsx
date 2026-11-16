import { Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis, type TooltipProps } from 'recharts';
import { RESPONSE_STATUS } from '@/constants/status';
import type { StatusCounts } from '@/types/api';

// Theme tokens, so charts follow light/dark mode automatically.
const BRAND = 'var(--color-brand)';
const LAVENDER = 'var(--color-chart-track)';
const GRID = 'var(--color-chart-grid)';
const AXIS = { fontSize: 12, fill: 'var(--color-muted)' };

/** Dark pill tooltip, as in the reference design ("55%"). */
function PillTooltip({ active, payload, label, suffix = '%' }: TooltipProps<number, string> & { suffix?: string }) {
  if (!active || !payload?.length) return null;
  const p = payload.find((x) => x.dataKey !== 'rest') ?? payload[0];
  return (
    <div className="rounded-md bg-tooltip px-2.5 py-1.5 text-xs font-semibold text-white shadow-pop">
      {label && <span className="mr-1.5 font-normal text-white/70">{label}</span>}
      {p.value == null ? 'n/a' : `${p.value}${suffix}`}
    </div>
  );
}

/** Percentage bars on a lavender 100% track – mirrors the reference bar style. */
export function PercentBars({ data, height = 300 }: { data: { label: string; percent: number | null; hint?: string }[]; height?: number }) {
  const rows = data.map((d) => ({ ...d, value: d.percent ?? 0, rest: 100 - (d.percent ?? 0) }));
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={rows} barCategoryGap="28%" margin={{ top: 16, right: 8, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
        <XAxis dataKey="label" tickLine={false} axisLine={false} tick={AXIS} interval={0} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={AXIS} width={52} />
        <Tooltip cursor={{ fill: 'transparent' }} content={<PillTooltip />} />
        <Bar dataKey="value" stackId="a" fill={BRAND} radius={[0, 0, 6, 6]} maxBarSize={72} isAnimationActive={false} />
        <Bar dataKey="rest" stackId="a" fill={LAVENDER} radius={[6, 6, 0, 0]} maxBarSize={72} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StatusPie({ counts, size = 220 }: { counts: StatusCounts; size?: number }) {
  const data = (Object.keys(RESPONSE_STATUS) as (keyof StatusCounts)[]).map((k) => ({ key: k, name: RESPONSE_STATUS[k].label, value: counts[k], color: RESPONSE_STATUS[k].color })).filter((d) => d.value > 0);
  const total = data.reduce((n, d) => n + d.value, 0);
  return (
    <div className="flex flex-col items-center">
      {!data.length ? (
        <div className="flex items-center justify-center" style={{ height: size }}>
          <div className="flex items-center justify-center rounded-full border-2 border-dashed border-line text-center text-[13px] text-muted" style={{ width: size - 20, height: size - 20 }}>
            No answers yet
          </div>
        </div>
      ) : (
      <ResponsiveContainer width="100%" height={size}>
        <PieChart>
          <Pie data={data.length ? data : [{ name: 'None', value: 1, color: LAVENDER }]} dataKey="value" nameKey="name" outerRadius={size / 2 - 10} innerRadius={0} stroke="var(--color-surface)" strokeWidth={data.length > 1 ? 2 : 0} isAnimationActive={false}>
            {(data.length ? data : [{ color: LAVENDER }]).map((d, i) => (
              <Cell key={i} fill={d.color} />
            ))}
          </Pie>
          {data.length > 0 && <Tooltip formatter={(v: number, n: string) => [`${v} (${Math.round((v / total) * 100)}%)`, n]} contentStyle={{ background: 'var(--color-surface)', border: '1px solid var(--color-line)', borderRadius: 8, color: 'var(--color-ink)' }} itemStyle={{ color: 'var(--color-ink)' }} />}
        </PieChart>
      </ResponsiveContainer>
      )}
      <ul className="mt-3 flex flex-wrap justify-center gap-x-4 gap-y-1.5 text-[13px] text-ink-2">
        {(Object.keys(RESPONSE_STATUS) as (keyof StatusCounts)[]).map((k) => (
          <li key={k} className="flex items-center gap-1.5">
            <span className="size-3 rounded-[3px]" style={{ background: RESPONSE_STATUS[k].color }} />
            <span className="tabular">{total ? Math.round((counts[k] / total) * 100) : 0}%</span> {RESPONSE_STATUS[k].label}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function CountBars({ data, height = 220, colorFor }: { data: { label: string; value: number }[]; height?: number; colorFor?: (label: string, i: number) => string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 24, left: 8, bottom: 4 }} barCategoryGap="30%">
        <CartesianGrid horizontal={false} stroke={GRID} strokeDasharray="4 4" />
        <XAxis type="number" allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS} />
        <YAxis type="category" dataKey="label" tickLine={false} axisLine={false} tick={AXIS} width={150} />
        <Tooltip cursor={{ fill: 'var(--color-subtle)' }} content={<PillTooltip suffix="" />} />
        <Bar dataKey="value" radius={[0, 6, 6, 0]} maxBarSize={22} isAnimationActive={false}>
          {data.map((d, i) => (
            <Cell key={d.label} fill={colorFor?.(d.label, i) ?? BRAND} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function TrendLine({ data, height = 220 }: { data: { period: string; compliancePercent: number | null }[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 16, right: 16, left: -12, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} strokeDasharray="4 4" />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tick={AXIS} />
        <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} tickLine={false} axisLine={false} tick={AXIS} width={52} />
        <Tooltip content={<PillTooltip />} />
        <Line type="monotone" dataKey="compliancePercent" stroke={BRAND} strokeWidth={2.5} dot={{ r: 4, fill: BRAND, strokeWidth: 0 }} connectNulls isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}
