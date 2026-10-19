/** Synthetic INPUT artwork, never a substitute for generated website output. */
import { PDFDocument, PDFName, PDFString, rgb, StandardFonts } from 'pdf-lib';

export async function syntheticCanvaPdf() {
  const pdf = await PDFDocument.create();
  const serif = await pdf.embedFont(StandardFonts.TimesRoman);
  const italic = await pdf.embedFont(StandardFonts.TimesRomanItalic);
  const sans = await pdf.embedFont(StandardFonts.Helvetica);
  const ink = rgb(0.24, 0.06, 0.14);
  const paper = rgb(0.99, 0.96, 0.92);
  const accent = rgb(0.8, 0.68, 0.55);
  const cover = pdf.addPage([500, 760]);
  cover.drawRectangle({ x: 0, y: 0, width: 500, height: 760, color: ink });
  cover.drawText('LUMEN', { x: 42, y: 625, size: 84, font: serif, color: paper });
  cover.drawText('TEST STUDIO', { x: 46, y: 593, size: 17, font: sans, color: accent });
  cover.drawText('A quiet moment, beautifully made.', { x: 44, y: 548, size: 24, font: italic, color: paper });
  cover.drawEllipse({ x: 380, y: 390, xScale: 88, yScale: 120, color: accent, opacity: 0.4 });
  cover.drawEllipse({ x: 332, y: 365, xScale: 88, yScale: 120, borderColor: paper, borderWidth: 1.5, opacity: 0.8 });
  const write = (text, x, y, size = 16, font = sans, color = paper) => cover.drawText(text, { x, y, size, font, color });
  write('Toronto, Ontario', 44, 272, 26, serif);
  write('Major intersection: Queen & Bathurst', 44, 238, 17);
  write('Exact address shared after booking.', 44, 210, 15);
  write('Tuesday - Saturday 10:00 AM - 6:00 PM', 44, 170, 16);
  write('Closed Sunday and Monday', 44, 144, 15);
  write('@lumen.test.studio', 44, 94, 18);
  write('hello@example.invalid', 44, 61, 18);
  const menu = pdf.addPage([800, 500]);
  menu.drawRectangle({ x: 0, y: 0, width: 800, height: 500, color: paper });
  menu.drawText('The service menu', { x: 38, y: 426, size: 46, font: serif, color: ink });
  menu.drawText('All prices CAD. Appointment times include the service.', { x: 40, y: 388, size: 17, font: sans, color: ink });
  for (const [index, service] of ['BIAB - $65 - 75 minutes', 'Gel Manicure - $50 - 60 minutes'].entries()) {
    const y = 295 - index * 90;
    menu.drawText(service, { x: 40, y: y + 12, size: 25, font: serif, color: ink });
    menu.drawRectangle({ x: 560, y, width: 200, height: 48, color: ink });
    menu.drawText(`BOOK ${index ? 'GEL' : 'BIAB'}`, { x: 588, y: y + 17, size: 18, font: sans, color: paper });
  }
  menu.drawText('Before your visit', { x: 40, y: 122, size: 28, font: italic, color: ink });
  menu.drawText('Cancel at least 24 hours before. No extra guests, please.', { x: 40, y: 87, size: 17, font: sans, color: ink });
  menu.drawText('Synthetic artwork for isolated testing.', { x: 40, y: 38, size: 12, font: sans, color: ink });
  // Negative fixture: visible artwork must never execute this document action.
  pdf.catalog.set(PDFName.of('OpenAction'), pdf.context.obj({
    S: 'JavaScript',
    JS: PDFString.of('globalThis.__lusterPdfScriptRan=true;fetch("https://example.invalid/pdf-open-action");'),
  }));
  return pdf.save();
}
