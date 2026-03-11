import type { MeetingBundle } from "@/hooks/useMeetingBundle";
import type { SectorViewConfig, ItemMapping } from "@/features/analysis/viewConfig.types";

// ── Shared helpers ────────────────────────────────────────────────────

const BADGE_LABELS: Record<string, string> = { high: "Alto", medium: "Medio", low: "Bajo" };

function field(obj: Record<string, unknown>, key: string): string {
  return String(obj[key] ?? "");
}

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });
}

// ── Section → Markdown ────────────────────────────────────────────────

function sectionToMarkdown(
  type: string,
  value: unknown,
  item?: ItemMapping,
): string {
  if (type === "text") {
    return typeof value === "string" && value ? value : "—";
  }

  if (type === "string_list") {
    if (!Array.isArray(value) || value.length === 0) return "—";
    return value.map((v) => `- ${v}`).join("\n");
  }

  if (type === "items_list" && item) {
    if (!Array.isArray(value) || value.length === 0) return "—";
    return value
      .filter((e) => e && typeof e === "object")
      .map((entry) => {
        const obj = entry as Record<string, unknown>;
        const text     = item.text     ? field(obj, item.text)     : "";
        const subtitle = item.subtitle ? field(obj, item.subtitle) : "";
        const owner    = item.owner    ? field(obj, item.owner)    : "";
        const date     = item.date     ? field(obj, item.date)     : "";
        const badge    = item.badge    ? field(obj, item.badge)    : "";
        if (!text) return null;
        const lines = [`**${text}**`];
        if (subtitle) lines.push(subtitle);
        const meta: string[] = [];
        if (owner) meta.push(`👤 ${owner}`);
        if (date)  meta.push(`📅 ${date}`);
        if (badge) meta.push(`[${BADGE_LABELS[badge] ?? badge}]`);
        if (meta.length) lines.push(meta.join(" · "));
        return lines.join("\n");
      })
      .filter(Boolean)
      .join("\n\n");
  }

  return "—";
}

// ── Section → HTML ────────────────────────────────────────────────────

function sectionToHtml(
  type: string,
  value: unknown,
  item?: ItemMapping,
): string {
  if (type === "text") {
    const text = typeof value === "string" && value ? value : "—";
    return `<p>${esc(text)}</p>`;
  }

  if (type === "string_list") {
    if (!Array.isArray(value) || value.length === 0) return "<p>—</p>";
    const items = value.map((v) => `<li>${esc(String(v))}</li>`).join("");
    return `<ul>${items}</ul>`;
  }

  if (type === "items_list" && item) {
    if (!Array.isArray(value) || value.length === 0) return "<p>—</p>";
    return value
      .filter((e) => e && typeof e === "object")
      .map((entry) => {
        const obj      = entry as Record<string, unknown>;
        const text     = item.text     ? field(obj, item.text)     : "";
        const subtitle = item.subtitle ? field(obj, item.subtitle) : "";
        const owner    = item.owner    ? field(obj, item.owner)    : "";
        const date     = item.date     ? field(obj, item.date)     : "";
        const badge    = item.badge    ? field(obj, item.badge)    : "";
        if (!text) return "";
        const meta: string[] = [];
        if (owner) meta.push(`👤 ${esc(owner)}`);
        if (date)  meta.push(`📅 ${esc(date)}`);
        if (badge) meta.push(`<span class="badge badge-${esc(badge)}">${esc(BADGE_LABELS[badge] ?? badge)}</span>`);
        return `<div class="item-card">
  <p class="item-text">${esc(text)}</p>
  ${subtitle ? `<p class="item-sub">${esc(subtitle)}</p>` : ""}
  ${meta.length ? `<p class="item-meta">${meta.join(" &nbsp;·&nbsp; ")}</p>` : ""}
</div>`;
      })
      .join("");
  }

  return "<p>—</p>";
}

// ── Public: Markdown (clipboard) ──────────────────────────────────────

export function analysisToMarkdown(
  bundle: MeetingBundle,
  viewConfig: SectorViewConfig | null,
): string {
  const { meeting, analysis } = bundle;
  const json = analysis?.analysis_json ?? {};

  const lines: string[] = [
    `# ${meeting.title}`,
    ``,
    `**Fecha:** ${fmtDate(meeting.created_at)}  |  **Sector:** ${meeting.sectors?.name ?? "—"}`,
    ``,
    `---`,
    ``,
  ];

  if (viewConfig?.tabs) {
    for (const tab of viewConfig.tabs) {
      lines.push(`## ${tab.label}`, ``);
      for (const section of tab.sections) {
        if (section.label) lines.push(`### ${section.label}`, ``);
        lines.push(sectionToMarkdown(section.type, json[section.field], section.item), ``);
      }
    }
  }

  return lines.join("\n");
}

// ── Public: Print window (PDF via browser) ────────────────────────────

export function openPrintWindow(
  bundle: MeetingBundle,
  viewConfig: SectorViewConfig | null,
): void {
  const { meeting, analysis } = bundle;
  const json = analysis?.analysis_json ?? {};

  let body = "";

  if (viewConfig?.tabs) {
    for (const tab of viewConfig.tabs) {
      body += `<section><h2>${esc(tab.label)}</h2>`;
      for (const section of tab.sections) {
        body += `<div class="section">`;
        if (section.label) body += `<h3>${esc(section.label)}</h3>`;
        body += sectionToHtml(section.type, json[section.field], section.item);
        body += `</div>`;
      }
      body += `</section>`;
    }
  }

  const html = `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="UTF-8">
<title>${esc(meeting.title)} — SintIA</title>
<style>
  *{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Georgia,serif;font-size:12pt;color:#111;max-width:750px;margin:0 auto;padding:24pt}
  h1{font-size:20pt;margin-bottom:4pt}
  .meta{font-size:10pt;color:#555;margin-bottom:16pt;border-bottom:1px solid #ddd;padding-bottom:8pt}
  h2{font-size:14pt;margin:20pt 0 8pt;border-bottom:1px solid #eee;padding-bottom:4pt;color:#1a1a2e}
  h3{font-size:11pt;margin:12pt 0 4pt;color:#444;font-style:italic}
  p{line-height:1.6;margin-bottom:6pt}
  ul{margin:0 0 8pt 18pt}
  li{margin-bottom:4pt;line-height:1.5}
  .section{margin-bottom:12pt}
  section{margin-bottom:16pt}
  .item-card{border:1px solid #e0e0e0;border-radius:4pt;padding:8pt 10pt;margin-bottom:6pt;background:#fafafa}
  .item-text{font-weight:bold;font-size:11pt;margin-bottom:2pt}
  .item-sub{font-size:10pt;color:#555;margin-bottom:2pt}
  .item-meta{font-size:9pt;color:#666}
  .badge{display:inline;font-size:8pt;padding:1pt 5pt;border-radius:3pt}
  .badge-high{background:#fee2e2;color:#b91c1c}
  .badge-medium{background:#dbeafe;color:#1d4ed8}
  .badge-low{background:#f3f4f6;color:#374151}
  .footer{margin-top:24pt;border-top:1px solid #ddd;padding-top:8pt;font-size:9pt;color:#999;text-align:center}
  @media print{body{padding:0}}
</style>
</head>
<body>
<h1>${esc(meeting.title)}</h1>
<div class="meta">${esc(fmtDate(meeting.created_at))} &nbsp;·&nbsp; ${esc(meeting.sectors?.name ?? "—")} &nbsp;·&nbsp; Generado por SintIA</div>
${body}
<div class="footer">Generado por SintIA &nbsp;·&nbsp; ${esc(fmtDate(new Date().toISOString()))}</div>
<script>window.onload=function(){window.print()}<\/script>
</body>
</html>`;

  const win = window.open("", "_blank");
  if (win) {
    win.document.write(html);
    win.document.close();
  }
}
