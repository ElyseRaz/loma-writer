/** ODF standard shape names -> our shape ids (the preset names of DrawingML). */
export const ODF_SHAPES: Record<string, string> = {
  rectangle: "rect", "round-rectangle": "roundRect", ellipse: "ellipse", "isosceles-triangle": "triangle", "right-triangle": "rtTriangle", diamond: "diamond", parallelogram: "parallelogram",
  trapezoid: "trapezoid", pentagon: "pentagon", hexagon: "hexagon", octagon: "octagon", cross: "plus", heart: "heart", cloud: "cloud", lightning: "lightningBolt", moon: "moon", ring: "donut",
  "right-arrow": "rightArrow", "left-arrow": "leftArrow", "up-arrow": "upArrow", "down-arrow": "downArrow", "left-right-arrow": "leftRightArrow", "up-down-arrow": "upDownArrow",
  chevron: "chevron", "pentagon-right": "homePlate", star4: "star4", star5: "star5", star6: "star6", star8: "star8", "rectangular-callout": "wedgeRectCallout", "round-callout": "wedgeEllipseCallout",
};

/** Our shape id -> the standard ODF name (where there is one). */
export const ODF_NAME_OF: Record<string, string> = Object.fromEntries(Object.entries(ODF_SHAPES).map(([odf, id]) => [id, odf]));
