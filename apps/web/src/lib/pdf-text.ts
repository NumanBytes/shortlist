// A PDF's text, read in the browser (docs/career-data.md §7.6): the file never leaves the
// device — only its text is sent, and the API never parses files. pdf.js is loaded only
// when someone imports a resume, and kept out of the offline app shell (vite.config.ts).
export async function pdfText(file: File): Promise<string> {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]);
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  try {
    const doc = await task.promise;
    const pages: string[] = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const content = await (await doc.getPage(n)).getTextContent();
      pages.push(content.items.map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : '') : '')).join(''));
    }
    return pages
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();
  } finally {
    void task.destroy(); // stops pdf.js's worker
  }
}
