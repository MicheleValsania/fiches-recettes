import html2canvas from "html2canvas";
import jsPDF from "jspdf";

type SupplierOrderPdfLabels = {
  title: string;
  code: string;
  name: string;
  residual: string;
  toOrder: string;
};

type SupplierOrderPdfRow = {
  code: string;
  name: string;
};

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

export async function exportSupplierOrderListPdf(
  rows: SupplierOrderPdfRow[],
  labels: SupplierOrderPdfLabels,
  meta: string,
  filename = "supplier-order.pdf"
) {
  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;
  const contentWidth = pageWidth - margin * 2;
  const tableTopGap = 6;
  const baseRowHeight = 7;
  const headerHeight = 8;
  const colWidths = [
    contentWidth * 0.2,
    contentWidth * 0.45,
    contentWidth * 0.175,
    contentWidth * 0.175,
  ];

  const drawTableHeader = (y: number) => {
    const headers = [
      labels.code || "Supplier code",
      labels.name || "Product name",
      labels.residual || "Residual product",
      labels.toOrder || "New quantity to order",
    ];
    let x = margin;
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(10);
    for (let i = 0; i < headers.length; i += 1) {
      const w = colWidths[i];
      pdf.rect(x, y, w, headerHeight, "S");
      pdf.text(headers[i], x + 2, y + 5.2, { maxWidth: w - 4 });
      x += w;
    }
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(9);
    return y + headerHeight;
  };

  const drawPageTop = () => {
    pdf.setTextColor(15, 23, 42);
    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(16);
    pdf.text(labels.title, margin, margin + 4);
    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(10);
    pdf.setTextColor(51, 65, 85);
    pdf.text(meta, margin, margin + 10);
    pdf.setDrawColor(203, 213, 225);
    return drawTableHeader(margin + 10 + tableTopGap);
  };

  let y = drawPageTop();
  pdf.setTextColor(15, 23, 42);
  pdf.setFont("helvetica", "normal");
  pdf.setFontSize(9);

  for (const row of rows) {
    const nameLines = pdf.splitTextToSize(row.name || "", colWidths[1] - 4);
    const rowHeight = Math.max(baseRowHeight, nameLines.length * 4 + 3);

    if (y + rowHeight > pageHeight - margin) {
      pdf.addPage();
      y = drawPageTop();
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
    }

    let x = margin;
    const values = [row.code || "", row.name || "", "", ""];
    for (let i = 0; i < values.length; i += 1) {
      const w = colWidths[i];
      pdf.rect(x, y, w, rowHeight);
      if (i === 1) {
        pdf.text(nameLines, x + 2, y + 4.3);
      } else if (values[i]) {
        pdf.text(values[i], x + 2, y + 4.8, { maxWidth: w - 4 });
      }
      x += w;
    }
    y += rowHeight;
  }

  const blob = pdf.output("blob") as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}
