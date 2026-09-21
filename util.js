// 共用小工具：把資料插入 innerHTML 前先跳脫，避免姓名／群組名稱等文字被當成 HTML 執行
function escapeHtml(value) {
  return String(value == null ? "" : value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
