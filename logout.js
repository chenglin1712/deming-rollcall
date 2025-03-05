document.addEventListener("DOMContentLoaded", function () {
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/api/logout", { method: "POST" })
        .then((response) => response.json())
        .then((data) => {
          if (data.success) {
            console.log("✅ 登出成功");
            sessionStorage.removeItem("user");
            localStorage.removeItem("user"); // 確保 localStorage 也被清除
            window.location.href = "login.html"; // 跳轉至登入頁
          } else {
            alert("❌ 登出失敗，請重試！");
          }
        })
        .catch((error) => {
          console.error("❌ 登出請求失敗:", error);
          alert("❌ 無法連接伺服器，請檢查網絡！");
        });
    });
  }
});
