document.addEventListener("DOMContentLoaded", function () {
  // ==========================================
  // 1. 權限檢查：僅允許管理員訪問
  // ==========================================
  fetch("/api/check-login")
    .then((response) => response.json())
    .then((data) => {
      if (!data.loggedIn) {
        // 未登入，跳轉回登入頁
        console.warn("🚫 未登入，重定向至 login.html");
        window.location.href = "login.html";
      } else if (data.user.username === "deming") {
        // 如果是樓長 (deming)，禁止訪問並跳轉
        alert("🚫 您沒有權限執行此操作");
        window.location.href = "index.html";
      } else {
        console.log("✅ 權限驗證通過，歡迎管理員:", data.user.display_name);
      }
    })
    .catch((error) => {
      console.error("權限檢查錯誤:", error);
      window.location.href = "login.html";
    });

  // ==========================================
  // 2. 處理檔案上傳邏輯
  // ==========================================
  const uploadForm = document.getElementById("upload-form");
  const uploadBtn = document.getElementById("upload-btn");
  const statusMessage = document.getElementById("status-message");
  const fileInput = document.getElementById("file-upload");

  if (uploadForm) {
    uploadForm.addEventListener("submit", function (e) {
      e.preventDefault(); // 防止表單預設提交行為 (避免頁面刷新)

      // 檢查是否已選擇檔案
      if (fileInput.files.length === 0) {
        alert("請先選擇一個 Excel 檔案！");
        return;
      }

      // 準備上傳資料
      const formData = new FormData();
      formData.append("file", fileInput.files[0]);

      // 鎖定按鈕，顯示處理中狀態
      uploadBtn.disabled = true;
      uploadBtn.textContent = "⏳ 匯入中，請稍候...";
      statusMessage.style.display = "none";
      statusMessage.className = ""; // 清除舊樣式

      // 發送 API 請求給後端
      fetch("/api/students/import", {
        method: "POST",
        body: formData,
      })
        .then((response) => response.json())
        .then((data) => {
          // 顯示訊息區域
          statusMessage.style.display = "block";
          statusMessage.style.padding = "15px";
          statusMessage.style.borderRadius = "5px";
          statusMessage.style.marginTop = "20px";

          if (data.success) {
            // ✅ 匯入成功
            statusMessage.style.backgroundColor = "#d4edda";
            statusMessage.style.color = "#155724";
            statusMessage.style.border = "1px solid #c3e6cb";
            statusMessage.innerHTML = `
              <h3 style="margin: 0 0 10px 0;">🎉 匯入成功！</h3>
              <p>${data.message}</p>
            `;

            // 3秒後清空選擇的檔案，讓使用者可以再次上傳
            setTimeout(() => {
              fileInput.value = "";
              uploadBtn.textContent = "開始匯入";
              uploadBtn.disabled = false;
            }, 3000);
          } else {
            // ❌ 匯入失敗 (例如格式錯誤、缺少欄位)
            statusMessage.style.backgroundColor = "#f8d7da";
            statusMessage.style.color = "#721c24";
            statusMessage.style.border = "1px solid #f5c6cb";
            statusMessage.innerHTML = `
              <h3 style="margin: 0 0 10px 0;">❌ 匯入失敗</h3>
              <p>${data.message}</p>
            `;

            // 恢復按鈕狀態
            uploadBtn.textContent = "開始匯入";
            uploadBtn.disabled = false;
          }
        })
        .catch((error) => {
          // ⚠️ 系統錯誤 (例如網絡斷線、伺服器掛掉)
          console.error("匯入發生錯誤:", error);
          statusMessage.style.display = "block";
          statusMessage.style.padding = "15px";
          statusMessage.style.borderRadius = "5px";
          statusMessage.style.backgroundColor = "#fff3cd";
          statusMessage.style.color = "#856404";
          statusMessage.style.border = "1px solid #ffeeba";
          statusMessage.innerHTML = `
            <h3 style="margin: 0 0 10px 0;">⚠️ 系統錯誤</h3>
            <p>無法連接伺服器，請檢查網絡連線或聯繫系統管理員。</p>
          `;

          uploadBtn.textContent = "開始匯入";
          uploadBtn.disabled = false;
        });
    });
  }
});
