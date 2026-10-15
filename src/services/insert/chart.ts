import { drawToPng } from "./raster";

export type ChartType = "bar" | "line" | "pie";

export interface ChartSpec {
  type: ChartType;
  title: string;
  /** One label per category (x axis, or pie slices). */
  labels: string[];
  series: Array<{ name: string; values: number[] }>;
}

export const CHART_COLORS = ["#2563eb", "#f97316", "#16a34a", "#9333ea", "#dc2626", "#0891b2", "#ca8a04", "#64748b"];

/** Rounds an axis maximum up to a "nice" number, and returns the tick step. */
export function niceScale(max: number, ticks = 5): { max: number; step: number } {
  if (!(max > 0)) return { max: 1, step: 0.2 };
  const raw = max / ticks;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  return { max: Math.ceil(max / step) * step, step };
}

export const chartIsValid = (s: ChartSpec) => s.labels.length > 0 && s.series.length > 0 && s.series.every((x) => x.values.length === s.labels.length && x.values.every(Number.isFinite));

const fmt = (n: number) => (Math.abs(n) >= 1000 ? n.toLocaleString("fr-FR") : String(+n.toFixed(2)).replace(".", ","));

export function renderChart(spec: ChartSpec, width = 560, height = 340) {
  return drawToPng(width, height, (ctx, w, h) => {
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.textBaseline = "middle";
    ctx.font = "600 16px Inter, sans-serif";
    ctx.fillStyle = "#1b1c1c";
    ctx.textAlign = "center";
    if (spec.title) ctx.fillText(spec.title, w / 2, 20);

    const legendH = spec.type === "pie" || spec.series.length > 1 ? 26 : 0;
    const top = spec.title ? 42 : 14;
    const bottom = h - legendH - 8;

    if (spec.type === "pie") {
      const values = spec.series[0].values.map((v) => Math.max(0, v));
      const total = values.reduce((a, b) => a + b, 0) || 1;
      const cx = w * 0.36, cy = (top + bottom) / 2, r = Math.min(w * 0.3, (bottom - top) / 2);
      let a0 = -Math.PI / 2;
      values.forEach((v, i) => {
        const a1 = a0 + (v / total) * Math.PI * 2;
        ctx.beginPath(); ctx.moveTo(cx, cy); ctx.arc(cx, cy, r, a0, a1); ctx.closePath();
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length]; ctx.fill();
        ctx.strokeStyle = "#fff"; ctx.lineWidth = 2; ctx.stroke();
        a0 = a1;
      });
      ctx.textAlign = "left"; ctx.font = "13px Inter, sans-serif";
      spec.labels.forEach((l, i) => {
        const y = top + 10 + i * 22;
        ctx.fillStyle = CHART_COLORS[i % CHART_COLORS.length]; ctx.fillRect(w * 0.72, y - 6, 12, 12);
        ctx.fillStyle = "#1b1c1c"; ctx.fillText(`${l} (${Math.round((values[i] / total) * 100)} %)`, w * 0.72 + 18, y);
      });
      return;
    }

    const all = spec.series.flatMap((s) => s.values);
    const lo = Math.min(0, ...all);
    const { max, step } = niceScale(Math.max(...all, 0));
    const left = 52, right = w - 16;
    const y = (v: number) => bottom - 24 - ((v - lo) / (max - lo || 1)) * (bottom - 24 - top);
    ctx.font = "11px Inter, sans-serif";
    ctx.textAlign = "right";
    for (let v = lo; v <= max + 1e-9; v += step) {
      ctx.strokeStyle = "#e5e7eb"; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(left, y(v)); ctx.lineTo(right, y(v)); ctx.stroke();
      ctx.fillStyle = "#6b7280"; ctx.fillText(fmt(v), left - 6, y(v));
    }
    const n = spec.labels.length;
    const slot = (right - left) / n;
    ctx.textAlign = "center";
    spec.labels.forEach((l, i) => { ctx.fillStyle = "#374151"; ctx.fillText(l.length > 12 ? `${l.slice(0, 11)}…` : l, left + slot * (i + 0.5), bottom - 10); });

    if (spec.type === "bar") {
      const group = slot * 0.7, bw = group / spec.series.length;
      spec.series.forEach((s, si) => s.values.forEach((v, i) => {
        const x = left + slot * i + (slot - group) / 2 + bw * si;
        ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length];
        ctx.fillRect(x, Math.min(y(v), y(0)), bw - 2, Math.abs(y(v) - y(0)));
      }));
    } else {
      spec.series.forEach((s, si) => {
        ctx.strokeStyle = CHART_COLORS[si % CHART_COLORS.length]; ctx.lineWidth = 2.5; ctx.lineJoin = "round";
        ctx.beginPath();
        s.values.forEach((v, i) => (i ? ctx.lineTo(left + slot * (i + 0.5), y(v)) : ctx.moveTo(left + slot * (i + 0.5), y(v))));
        ctx.stroke();
        s.values.forEach((v, i) => { ctx.beginPath(); ctx.arc(left + slot * (i + 0.5), y(v), 3.5, 0, Math.PI * 2); ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length]; ctx.fill(); });
      });
    }
    if (legendH) {
      ctx.textAlign = "left"; ctx.font = "12px Inter, sans-serif";
      let x = left;
      spec.series.forEach((s, si) => {
        ctx.fillStyle = CHART_COLORS[si % CHART_COLORS.length]; ctx.fillRect(x, h - 20, 12, 12);
        ctx.fillStyle = "#1b1c1c"; ctx.fillText(s.name, x + 17, h - 14);
        x += 30 + ctx.measureText(s.name).width;
      });
    }
  });
}

/** Alternative text describing the chart, so the data is not lost behind the picture. */
export function chartAltText(spec: ChartSpec): string {
  const kind = { bar: "Histogramme", line: "Courbes", pie: "Secteurs" }[spec.type];
  const rows = spec.labels.map((l, i) => `${l} : ${spec.series.map((s) => `${s.name} ${fmt(s.values[i])}`).join(", ")}`).join(" ; ");
  return `${kind}${spec.title ? ` « ${spec.title} »` : ""} — ${rows}`;
}
