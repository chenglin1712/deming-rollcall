document.addEventListener("DOMContentLoaded", function () {
  console.log("宿舍點名系統已啟動");

  // 如果需要檢查SQLite連接或執行初始化操作，可以在這裡添加代碼
  checkDatabaseConnection();
});

// 檢查資料庫連接
function checkDatabaseConnection() {
  fetch("/api/check-connection")
    .then((response) => response.json())
    .then((data) => {
      if (data.connected) {
        console.log("成功連接到SQLite資料庫");
      } else {
        console.error("資料庫連接失敗:", data.error);
        alert("無法連接到資料庫，請確保後端服務已啟動。");
      }
    })
    .catch((error) => {
      console.error("檢查資料庫連接時出錯:", error);
    });
}
