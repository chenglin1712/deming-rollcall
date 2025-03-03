document.addEventListener("DOMContentLoaded", function () {
  // 頁面加載時載入可選的歷史點名日期
  loadDateOptions();

  // 綁定按鈕事件
  document
    .getElementById("filter-btn")
    .addEventListener("click", loadHistoryData);
  document
    .getElementById("export-btn")
    .addEventListener("click", exportToExcel);

  // 頁面加載時直接顯示所有歷史紀錄
  loadHistoryData();
});

// **🔹 修正 1️⃣：載入歷史點名日期，避免報錯**
function loadDateOptions() {
  fetch("/api/attendance/dates")
    .then((response) => {
      if (!response.ok) {
        throw new Error("❌ 無法獲取日期列表");
      }
      return response.json();
    })
    .then((dates) => {
      const dateSelect = document.getElementById("date-select");

      // 清空現有選項（保留預設選項）
      dateSelect.innerHTML = '<option value="">--- 請選擇日期 ---</option>';

      // 添加日期選項
      dates.forEach((date) => {
        const option = document.createElement("option");
        option.value = date;

        // 格式化日期顯示
        const formattedDate = new Date(date).toLocaleDateString("zh-TW", {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        });

        option.textContent = formattedDate;
        dateSelect.appendChild(option);
      });
    })
    .catch((error) => {
      console.error("載入歷史日期時出錯:", error);
      // **修正：避免直接報錯，讓頁面正常運作**
      alert("⚠️ 無法載入歷史日期，請稍後再試，但你仍可瀏覽點名紀錄。");
    });
}

// **🔹 修正 3️⃣：根據篩選條件載入歷史數據**
function loadHistoryData() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  let apiUrl = "/api/attendance/history";
  const queryParams = [];

  if (date) {
    queryParams.push(`date=${encodeURIComponent(date)}`);
  }
  if (group) {
    queryParams.push(`group=${encodeURIComponent(group)}`);
  }
  if (queryParams.length > 0) {
    apiUrl += "?" + queryParams.join("&");
  }

  fetch(apiUrl)
    .then((response) => response.json())
    .then((data) => {
      console.log("API 回應資料:", data); // **用於除錯**
      if (!data.success) {
        throw new Error("API 回傳失敗");
      }
      displayHistoryData(data.data);
    })
    .catch((error) => {
      console.error("載入歷史數據時出錯:", error);
      alert("❌ 載入歷史數據失敗，請稍後再試。");
    });
}

// **🔹 修正 2️⃣：修正欄位對應**
function displayHistoryData(records) {
  const tableBody = document.getElementById("history-data");
  tableBody.innerHTML = ""; // **清空舊數據**

  if (records.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 4;
    emptyCell.textContent = "沒有找到歷史紀錄";
    emptyCell.style.textAlign = "center";
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  records.forEach((record) => {
    const row = document.createElement("tr");

    const formattedDate = new Date(record.date).toLocaleDateString("zh-TW");

    // **修正欄位名稱，確保匹配 API 回傳的資料**
    const cells = [
      formattedDate, // 日期
      record.roomNumber || "N/A", // 房號（如果 API 沒有，則顯示 "N/A"）
      record.studentName, // 學生姓名
      record.status, // 狀態 (在寢 / 未歸)
    ];

    cells.forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.appendChild(cell);
    });

    // **根據狀態設定不同的樣式**
    if (record.status === "未歸") {
      row.classList.add("status-absent");
    } else if (record.status === "晚歸") {
      row.classList.add("status-late");
    }

    tableBody.appendChild(row);
  });
}

// **🔹 匯出資料為 Excel**
function exportToExcel() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  if (!date) {
    alert("請選擇一個日期以匯出資料");
    return;
  }

  // **構建匯出 API 查詢參數**
  let exportUrl = `/api/attendance/export?date=${encodeURIComponent(date)}`;
  if (group) {
    exportUrl += `&group=${encodeURIComponent(group)}`;
  }

  // **下載 Excel 檔案**
  window.location.href = exportUrl;
}
