import QRCode from "qrcode";

const XML_ESCAPE_MAP = {
  "&": "&amp;",
  "\"": "&quot;",
  "<": "&lt;",
  ">": "&gt;",
};

const encodeXmlAttribute = (value) => String(value || "").replace(/[&"<>]/g, (char) => XML_ESCAPE_MAP[char] || char);

async function buildQrCodeSvg(value) {
  const payload = String(value || "").trim();
  if (!payload) {
    return "";
  }
  const svg = await QRCode.toString(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    type: "svg",
    width: 220,
  });
  return svg.replace("<svg ", `<svg role="img" aria-label="${encodeXmlAttribute(payload)}" `);
}

async function buildQrCodePngDataUrl(value) {
  const payload = String(value || "").trim();
  if (!payload) {
    return "";
  }
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    width: 512,
  });
}

function buildSvgImageDataUrl(svg) {
  const normalized = String(svg || "").trim();
  if (!normalized) {
    return "";
  }
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(normalized)}`;
}

export { buildQrCodePngDataUrl, buildQrCodeSvg, buildSvgImageDataUrl };
