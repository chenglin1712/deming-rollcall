document.addEventListener("DOMContentLoaded", function () {
  const loginForm = document.getElementById("login-form");
  const loginBtn = document.getElementById("login-btn");
  const errorMessage = document.getElementById("error-message");
  const loadingMessage = document.getElementById("loading-message");

  // **🔍 檢查是否已登入**
  fetch("/api/check-login")
    .then((response) => response.json())
    .then((data) => {
      if (data.loggedIn) {
        console.log("✅ 已登入，跳轉至首頁");
        window.location.href = "index.html";
      }
    })
    .catch((error) => console.error("❌ 無法確認登入狀態:", error));

  // **🔐 處理登入表單提交**
  loginForm.addEventListener("submit", function (event) {
    event.preventDefault(); // 防止表單自動提交

    const username = document.getElementById("username").value.trim();
    const password = document.getElementById("password").value.trim();

    if (!username || !password) {
      errorMessage.textContent = "⚠️ 帳號與密碼不能為空！";
      errorMessage.style.display = "block";
      return;
    }

    // 顯示 Loading，禁用按鈕
    loginBtn.disabled = true;
    loadingMessage.style.display = "block";
    errorMessage.style.display = "none";

    fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    })
      .then((response) => {
        if (!response.ok) {
          throw new Error("登入失敗，請檢查帳號密碼！");
        }
        return response.json();
      })
      .then((data) => {
        console.log("✅ 登入成功:", data);
        sessionStorage.setItem("user", JSON.stringify(data.user)); // 儲存 session
        window.location.href = "index.html"; // 成功後跳轉首頁
      })
      .catch((error) => {
        console.error("❌ 登入錯誤:", error);
        errorMessage.style.display = "block";
        errorMessage.textContent = "❌ 帳號或密碼錯誤，請重試！";
      })
      .finally(() => {
        // 隱藏 Loading，啟用按鈕
        loginBtn.disabled = false;
        loadingMessage.style.display = "none";
      });
  });

  // **🔓 確保受保護頁面未登入時跳轉 `login.html`**
  const protectedPages = [
    "index.html",
    "add_student.html",
    "attendance.html",
    "history.html",
    "student_list.html",
  ];
  if (protectedPages.includes(window.location.pathname.split("/").pop())) {
    fetch("/api/check-login")
      .then((response) => response.json())
      .then((data) => {
        if (!data.loggedIn) {
          console.log("🚫 未登入，跳轉至 login.html");
          window.location.href = "login.html";
        }
      })
      .catch((error) => console.error("❌ 無法確認登入狀態:", error));
  }

  // **🔓 登出功能**
  const logoutBtn = document.getElementById("logout-btn");
  if (logoutBtn) {
    logoutBtn.addEventListener("click", function () {
      fetch("/api/logout", { method: "POST" })
        .then((response) => response.json())
        .then((data) => {
          console.log("🚪 登出成功:", data);
          sessionStorage.removeItem("user"); // 移除 session
          window.location.href = "login.html"; // 成功登出後跳轉回登入頁面
        })
        .catch((error) => console.error("❌ 登出失敗:", error));
    });
  }
});
