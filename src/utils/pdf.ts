import html2canvas from "html2canvas";
import jsPDF from "jspdf";

export async function exportElementToA4Pdf(
  element: HTMLElement,
  filename = "fiche-technique.pdf"
) {
  // “Fotografa” il contenuto con buona qualità
  const canvas = await html2canvas(element, {
    scale: 2,
    useCORS: true,
    backgroundColor: "#ffffff",
  });

  const imgData = canvas.toDataURL("image/png");

  const pdf = new jsPDF("p", "mm", "a4");
  const pageWidth = 210;
  const pageHeight = 297;

  // dimensioni immagine su pagina mantenendo proporzioni
  const imgProps = pdf.getImageProperties(imgData);
  const imgWidth = pageWidth;
  const imgHeight = (imgProps.height * imgWidth) / imgProps.width;

  // Se sfora, gestiamo più pagine “tagliando” verticalmente
  let position = 0;
  let heightLeft = imgHeight;

  pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
  heightLeft -= pageHeight;

  while (heightLeft > 0) {
    pdf.addPage();
    position = heightLeft - imgHeight; // negativo, sposta su l’immagine
    pdf.addImage(imgData, "PNG", 0, position, imgWidth, imgHeight);
    heightLeft -= pageHeight;
  }

  pdf.save(filename);
}
