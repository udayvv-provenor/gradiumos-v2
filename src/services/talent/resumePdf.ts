/**
 * Print-ready HTML renderer for resumes.
 * pdfkit is not in the backend deps (see package.json), so we ship a minimally-styled
 * HTML/CSS document that renders well in a browser's print dialog. Clients can invoke
 * window.print() to produce a PDF.
 */

interface ResumeSectionItem {
  title?: string;
  subtitle?: string;
  bullets?: string[];
  body?: string;
}
interface ResumeSection {
  type: 'experience' | 'skills' | 'education' | 'certifications' | 'projects';
  items: ResumeSectionItem[];
}

export interface ResumeLikeRecord {
  id: string;
  headline: string;
  summary: string;
  sections: ResumeSection[];
  createdAt: string;
  learnerName: string;
  variant: string;
  signalScoreAtGen: number;
  signalConfAtGen: number;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sectionTitle(type: ResumeSection['type']): string {
  switch (type) {
    case 'experience':     return 'Experience';
    case 'skills':         return 'Core Skills';
    case 'education':      return 'Education';
    case 'certifications': return 'Certifications';
    case 'projects':       return 'Projects';
  }
}

export function renderResumeHtml(r: ResumeLikeRecord): string {
  const sectionsHtml = r.sections.map((sec) => {
    const itemsHtml = sec.items.map((it) => {
      const head = it.title ? `<div class="item-title">${escapeHtml(it.title)}</div>` : '';
      const sub  = it.subtitle ? `<div class="item-subtitle">${escapeHtml(it.subtitle)}</div>` : '';
      const bullets = it.bullets && it.bullets.length > 0
        ? `<ul>${it.bullets.map((b) => `<li>${escapeHtml(b)}</li>`).join('')}</ul>`
        : '';
      const body = it.body ? `<p>${escapeHtml(it.body)}</p>` : '';
      return `<div class="item">${head}${sub}${bullets}${body}</div>`;
    }).join('');
    return `<section><h2>${sectionTitle(sec.type)}</h2>${itemsHtml}</section>`;
  }).join('');

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<title>${escapeHtml(r.learnerName)} — Resume</title>
<style>
  @page { margin: 18mm 16mm; }
  body { font-family: 'DM Sans', Arial, sans-serif; color: #0B1D26; margin: 0; line-height: 1.45; }
  header { border-bottom: 2px solid #0B7165; padding-bottom: 10px; margin-bottom: 16px; }
  header h1 { font-family: 'Playfair Display', Georgia, serif; font-size: 26pt; margin: 0; color: #0B7165; }
  header .headline { font-size: 12pt; color: #344A55; margin-top: 4px; }
  header .stamp { font-size: 9pt; color: #556; margin-top: 6px; }
  .summary { font-size: 11pt; margin: 10px 0 18px; }
  section h2 { font-family: 'Playfair Display', Georgia, serif; font-size: 13pt; color: #0B7165; border-bottom: 1px solid #d8e0e2; padding-bottom: 4px; margin: 14px 0 8px; }
  .item { margin-bottom: 10px; }
  .item-title { font-weight: 600; font-size: 11pt; }
  .item-subtitle { font-style: italic; font-size: 10pt; color: #40555F; margin-bottom: 4px; }
  ul { margin: 4px 0 0 18px; padding: 0; }
  li { font-size: 10pt; margin-bottom: 3px; }
  @media print {
    body { print-color-adjust: exact; }
  }
</style>
</head>
<body>
  <header>
    <h1>${escapeHtml(r.learnerName)}</h1>
    <div class="headline">${escapeHtml(r.headline)}</div>
    <div class="stamp">Generated ${escapeHtml(r.createdAt)} · Variant ${escapeHtml(r.variant)} · GradiumOS Signal ${r.signalScoreAtGen} (conf ${r.signalConfAtGen.toFixed(2)})</div>
  </header>
  <div class="summary">${escapeHtml(r.summary)}</div>
  ${sectionsHtml}
</body>
</html>`;
}
