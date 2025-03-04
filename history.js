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
  document
    .getElementById("export-csv-btn")
    .addEventListener("click", exportToCSV); // 加入 CSV 匯出按鈕事件

  // 頁面加載時直接顯示所有歷史紀錄
  loadHistoryData();
});

// **🔹 載入歷史點名日期**
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
      dateSelect.innerHTML = '<option value="">--- 請選擇日期 ---</option>';

      dates.forEach((date) => {
        const option = document.createElement("option");
        option.value = date;

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
      alert("⚠️ 無法載入歷史日期，請稍後再試，但你仍可瀏覽點名紀錄。");
    });
}

// **🔹 載入歷史數據**
function loadHistoryData() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  let apiUrl = "/api/attendance/history";
  const queryParams = [];

  if (date) queryParams.push(`date=${encodeURIComponent(date)}`);
  if (group) queryParams.push(`group=${encodeURIComponent(group)}`);
  if (queryParams.length > 0) apiUrl += "?" + queryParams.join("&");

  fetch(apiUrl)
    .then((response) => response.json())
    .then((data) => {
      console.log("API 回應資料:", data);
      if (!data.success) throw new Error("API 回傳失敗");
      displayHistoryData(data.data);
    })
    .catch((error) => {
      console.error("載入歷史數據時出錯:", error);
      alert("❌ 載入歷史數據失敗，請稍後再試。");
    });
}

// **🔹 顯示歷史數據**
function displayHistoryData(records) {
  const tableBody = document.getElementById("history-data");
  tableBody.innerHTML = "";

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

    const cells = [
      formattedDate,
      record.roomNumber || "N/A",
      record.studentName,
      record.status,
    ];

    cells.forEach((text) => {
      const cell = document.createElement("td");
      cell.textContent = text;
      row.appendChild(cell);
    });

    if (record.status === "未歸") row.classList.add("status-absent");
    else if (record.status === "晚歸") row.classList.add("status-late");

    tableBody.appendChild(row);
  });
}

// **🔹 匯出為 Excel**
function exportToExcel() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  if (!date) {
    alert("請選擇一個日期以匯出資料");
    return;
  }

  let exportUrl = `/api/attendance/export?date=${encodeURIComponent(date)}`;
  if (group) exportUrl += `&group=${encodeURIComponent(group)}`;

  window.location.href = exportUrl;
}

// **🔹 匯出為 CSV**
function exportToCSV() {
  const table = document.getElementById("history-data");
  if (!table || table.rows.length === 0) {
    alert("⚠️ 無可匯出的歷史紀錄");
    return;
  }

  let csvContent = "data:text/csv;charset=utf-8,日期,房號,學生姓名,狀態\n";
  for (let row of table.rows) {
    let rowData = [];
    for (let cell of row.cells) {
      rowData.push(cell.textContent);
    }
    csvContent += rowData.join(",") + "\n";
  }

  const link = document.createElement("a");
  link.setAttribute("href", encodeURI(csvContent));
  link.setAttribute("download", "attendance_history.csv");
  document.body.appendChild(link);
  link.click();
}
