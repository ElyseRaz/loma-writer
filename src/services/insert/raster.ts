/** Draws on an offscreen canvas and returns a PNG data URI with its logical size. */
export function drawToPng(width: number, height: number, draw: (ctx: CanvasRenderingContext2D, w: number, h: number) => void, scale = 2): { src: string; width: number; height: number } {
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Le dessin n'est pas disponible dans cet environnement.");
  ctx.scale(scale, scale);
  draw(ctx, width, height);
  return { src: canvas.toDataURL("image/png"), width, height };
}

/** Rasterises an SVG string (icons) so it can be stored as a picture that DOCX and ODT understand. */
export function svgToPng(svg: string, size: number, scale = 2): Promise<{ src: string; width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        resolve(drawToPng(size, size, (ctx) => ctx.drawImage(img, 0, 0, size, size), scale));
      } catch (e) {
        reject(e);
      }
    };
    img.onerror = () => reject(new Error("Icône illisible."));
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  });
}
