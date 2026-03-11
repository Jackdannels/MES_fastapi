const APP_TITLE = "七二四新火工区信息化中控管理系统";

function buildDocumentTitle(pageTitle) {
  const safePageTitle = String(pageTitle || "").trim();
  return safePageTitle ? `${safePageTitle} - ${APP_TITLE}` : APP_TITLE;
}

export { APP_TITLE, buildDocumentTitle };
