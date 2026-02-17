import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function renderElementToA4PdfBlob(element: HTMLElement): Promise<Blob> {
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const contentHeight = pageHeight - margin * 2;
  const pageSourceHeight = (contentHeight * canvas.width) / contentWidth;
  let sourceY = 0;
  let isFirstPage = true;
  while (sourceY < canvas.height) {
    const remaining = canvas.height - sourceY;
    const sourceHeight = Math.min(pageSourceHeight, remaining);
    const renderHeight = (sourceHeight * contentWidth) / canvas.width;
    const sliceCanvas = document.createElement("canvas");
    sliceCanvas.width = canvas.width;
    sliceCanvas.height = Math.ceil(sourceHeight);
    const ctx = sliceCanvas.getContext("2d");
    if (!ctx) throw new Error("Cannot create PDF canvas context");
    ctx.drawImage(
      canvas,
      0,
      sourceY,
      canvas.width,
      sourceHeight,
      0,
      0,
      canvas.width,
      sourceHeight
    );
    const sliceData = sliceCanvas.toDataURL("image/png");

    if (!isFirstPage) pdf.addPage();
    pdf.addImage(sliceData, "PNG", margin, margin, contentWidth, renderHeight, undefined, "FAST");

    sourceY += sourceHeight;
    isFirstPage = false;
  }

  return pdf.output("blob") as Blob;
}

export async function exportElementToA4Pdf(
  element: HTMLElement,
  filename = "fiche-technique.pdf"
) {
  const blob = await renderElementToA4PdfBlob(element);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
