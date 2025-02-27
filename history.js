document.addEventListener("DOMContentLoaded", function () {
  // 載入歷史點名日期列表
  loadDateOptions();

  // 綁定按鈕事件
  document
    .getElementById("filter-btn")
    .addEventListener("click", loadHistoryData);
  document
    .getElementById("export-btn")
    .addEventListener("click", exportToExcel);
});

// 載入歷史點名日期選項
function loadDateOptions() {
  fetch("/api/attendance/dates")
    .then((response) => response.json())
    .then((dates) => {
      const dateSelect = document.getElementById("date-select");

      // 清空現有選項（保留預設選項）
      const defaultOption = dateSelect.options[0];
      dateSelect.innerHTML = "";
      dateSelect.appendChild(defaultOption);

      // 添加日期選項
      dates.forEach((date) => {
        const option = document.createElement("option");
        option.value = date;

        // 將日期格式化為更易讀的形式
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
      alert("無法載入歷史日期，請確保資料庫連接正常。");
    });
}

// 根據篩選條件載入歷史數據
function loadHistoryData() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  if (!date) {
    alert("請選擇一個日期");
    return;
  }

  // 構建API查詢參數
  let apiUrl = `/api/attendance/history?date=${encodeURIComponent(date)}`;
  if (group) {
    apiUrl += `&group=${encodeURIComponent(group)}`;
  }

  fetch(apiUrl)
    .then((response) => response.json())
    .then((records) => {
      displayHistoryData(records);
    })
    .catch((error) => {
      console.error("載入歷史數據時出錯:", error);
      alert("載入歷史數據失敗，請稍後再試。");
    });
}

// 顯示歷史點名數據
function displayHistoryData(records) {
  const tableBody = document.getElementById("history-data");

  // 清空現有數據
  tableBody.innerHTML = "";

  if (records.length === 0) {
    const emptyRow = document.createElement("tr");
    const emptyCell = document.createElement("td");
    emptyCell.colSpan = 4;
    emptyCell.textContent = "沒有找到符合條件的紀錄";
    emptyCell.style.textAlign = "center";
    emptyRow.appendChild(emptyCell);
    tableBody.appendChild(emptyRow);
    return;
  }

  // 添加數據行
  records.forEach((record) => {
    const row = document.createElement("tr");

    // 格式化日期
    const formattedDate = new Date(record.date).toLocaleDateString("zh-TW");

    // 添加單元格
    const cells = [
      formattedDate,
      record.roomNumber,
      record.name,
      record.status,
    ];

    cells.forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.appendChild(cell);
    });

    // 根據狀態添加不同的樣式
    if (record.status === "未歸") {
      row.classList.add("status-absent");
    } else if (record.status === "晚歸") {
      row.classList.add("status-late");
    }

    tableBody.appendChild(row);
  });
}

// 匯出資料為Excel
function exportToExcel() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  if (!date) {
    alert("請選擇一個日期以匯出資料");
    return;
  }

  // 構建匯出API查詢參數
  let exportUrl = `/api/attendance/export?date=${encodeURIComponent(date)}`;
  if (group) {
    exportUrl += `&group=${encodeURIComponent(group)}`;
  }

  // 下載Excel檔案
  window.location.href = exportUrl;
}
