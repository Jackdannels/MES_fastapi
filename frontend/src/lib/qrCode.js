import QRCode from "qrcode";

async function buildQrCodeSvg(value) {
  const payload = String(value || "").trim();
  if (!payload) {
    return "";
  }
  return QRCode.toString(payload, {
    errorCorrectionLevel: "M",
    margin: 2,
    type: "svg",
    width: 220,
  });
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
