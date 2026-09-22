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
          if (data.success) {
            showStatus("success", "🎉 匯入成功！", data.message, data.skipped, data.skippedCount, data.skippedTruncated);

            // 3秒後清空選擇的檔案，讓使用者可以再次上傳
            setTimeout(() => {
              fileInput.value = "";
              uploadBtn.textContent = "開始匯入";
              uploadBtn.disabled = false;
            }, 3000);
          } else {
            // ❌ 匯入失敗 (例如格式錯誤、缺少欄位、或全部資料列都因欄位問題被略過)
            showStatus("error", "❌ 匯入失敗", data.message, data.skipped, data.skippedCount, data.skippedTruncated);
            uploadBtn.textContent = "開始匯入";
            uploadBtn.disabled = false;
          }
        })
        .catch((error) => {
          // ⚠️ 系統錯誤 (例如網絡斷線、伺服器掛掉)
          console.error("匯入發生錯誤:", error);
          showStatus("warning", "⚠️ 系統錯誤", "無法連接伺服器，請檢查網絡連線或聯繫系統管理員。");
          uploadBtn.textContent = "開始匯入";
          uploadBtn.disabled = false;
        });
    });
  }

  const STATUS_STYLES = {
    success: { bg: "#d4edda", color: "#155724", border: "#c3e6cb" },
    error:   { bg: "#f8d7da", color: "#721c24", border: "#f5c6cb" },
    warning: { bg: "#fff3cd", color: "#856404", border: "#ffeeba" },
  };

  // 用 DOM API 組裝匯入結果訊息（title/message 目前皆為固定文字，
  // 但略過清單來自上傳檔案的內容，一律用 textContent 避免被當成 HTML）
  function showStatus(type, title, message, skipped, skippedCount, truncated) {
    const style = STATUS_STYLES[type];
    statusMessage.style.display = "block";
    statusMessage.style.padding = "15px";
    statusMessage.style.borderRadius = "5px";
    statusMessage.style.marginTop = "20px";
    statusMessage.style.backgroundColor = style.bg;
    statusMessage.style.color = style.color;
    statusMessage.style.border = `1px solid ${style.border}`;
    statusMessage.innerHTML = "";

    const h3 = document.createElement("h3");
    h3.style.margin = "0 0 10px 0";
    h3.textContent = title;
    statusMessage.appendChild(h3);

    const p = document.createElement("p");
    p.textContent = message;
    statusMessage.appendChild(p);

    if (skipped && skipped.length > 0) {
      const details = document.createElement("details");
      details.style.marginTop = "10px";
      const total = skippedCount ?? skipped.length; // skippedCount 是實際總數，skipped 最多只帶前 200 筆
      details.open = total <= 10; // 筆數少直接展開，多的話收合避免版面過長

      const summary = document.createElement("summary");
      summary.style.cursor = "pointer";
      summary.style.fontWeight = "bold";
      summary.textContent = `略過的資料列（共 ${total} 筆）${truncated ? `，以下僅列出前 ${skipped.length} 筆` : ""}`;
      details.appendChild(summary);

      const tableWrap = document.createElement("div");
      tableWrap.style.cssText = "max-height:320px; overflow:auto; margin-top:8px;";

      const table = document.createElement("table");
      table.style.cssText = "width:100%; font-size:0.85rem; border-collapse:collapse; word-break:break-all; overflow-wrap:anywhere;";
      const thead = document.createElement("thead");
      const headRow = document.createElement("tr");
      ["列", "學號", "姓名", "原因"].forEach((text) => {
        const th = document.createElement("th");
        th.style.cssText = "text-align:left; padding:4px 8px; border-bottom:1px solid currentColor;";
        th.textContent = text;
        headRow.appendChild(th);
      });
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = document.createElement("tbody");
      skipped.forEach((s) => {
        const tr = document.createElement("tr");
        [s.row, s.id, s.name, s.reason].forEach((val) => {
          const td = document.createElement("td");
          td.style.cssText = "padding:4px 8px; border-bottom:1px solid rgba(0,0,0,.08);";
          td.textContent = val;
          tr.appendChild(td);
        });
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      tableWrap.appendChild(table);
      details.appendChild(tableWrap);
      statusMessage.appendChild(details);
    }
  }
});
