document.addEventListener("DOMContentLoaded", function () {
  // 頁面加載時載入可選的歷史點名日期和群組
  loadDateOptions();
  loadGroupOptions();

  // 綁定按鈕事件
  document
    .getElementById("filter-btn")
    .addEventListener("click", loadHistoryData);
  document
    .getElementById("export-btn")
    .addEventListener("click", exportToExcel);
  document
    .getElementById("export-csv-btn")
    .addEventListener("click", exportToCSV);

  // 🆕 綁定清空按鈕事件
  const clearBtn = document.getElementById("clear-btn");
  if (clearBtn) {
    clearBtn.addEventListener("click", clearAllHistory);
  }

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
      // 保留第一項提示，清空舊選項
      dateSelect.innerHTML = '<option value="">-- 請選擇日期 --</option>';

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
    });
}

// **🔹 載入群組名稱**
function loadGroupOptions() {
  fetch("/api/groups")
    .then((response) => response.json())
    .then((groups) => {
      const groupSelect = document.getElementById("group-select");
      groupSelect.innerHTML = '<option value="">全部群組</option>';

      groups.forEach((group) => {
        const option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        groupSelect.appendChild(option);
      });
    })
    .catch((error) => console.error("❌ 無法載入群組:", error));
}

// **🔹 查詢歷史數據**
function loadHistoryData() {
  const date = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value.trim();

  let apiUrl = "/api/attendance/history";
  const queryParams = [];

  if (date) queryParams.push(`date=${encodeURIComponent(date)}`);
  if (group !== "") queryParams.push(`group=${encodeURIComponent(group)}`);

  if (queryParams.length > 0) apiUrl += "?" + queryParams.join("&");

  fetch(apiUrl)
    .then((response) => response.json())
    .then((data) => {
      console.log("API 回應資料:", data);

      if (!data.success || !Array.isArray(data.data)) {
        throw new Error("API 回應失敗或數據格式錯誤");
      }

      displayHistoryData(data.data);
    })
    .catch((error) => {
      console.error("載入歷史數據時出錯:", error);
      const tableBody = document.getElementById("history-data");
      tableBody.innerHTML =
        "<tr><td colspan='4' style='text-align:center; color:red;'>❌ 查詢失敗或無資料</td></tr>";
    });
}

// **🔹 顯示歷史數據**
function displayHistoryData(records) {
  const tableBody = document.getElementById("history-data");
  tableBody.innerHTML = "";

  if (!records || records.length === 0) {
    const emptyRow = document.createElement("tr");
    emptyRow.innerHTML = `<td colspan="4" style="text-align:center; color:gray;">🔍 無點名資料</td>`;
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

// **🆕 🔹 清除所有歷史紀錄 (新增功能)**
function clearAllHistory() {
  // 第一道防線
  if (
    !confirm(
      "⚠️ 嚴重警告：\n\n這將會「永久刪除」資料庫中所有的點名紀錄！\n\n此操作無法復原，您確定要繼續嗎？"
    )
  ) {
    return;
  }

  // 第二道防線
  if (!confirm("🚨 最後確認：\n\n真的要清空所有資料嗎？請謹慎操作。")) {
    return;
  }

  fetch("/api/attendance/clear", {
    method: "DELETE",
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert("✅ " + data.message);
        // 清除後重新載入頁面，讓表格變空
        window.location.reload();
      } else {
        alert("❌ 清除失敗: " + data.message);
      }
    })
    .catch((error) => {
      console.error("清除請求錯誤:", error);
      alert("❌ 無法連接伺服器");
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

  // 檢查是否真的有 export API (需要你在 server.js 實作，否則會 404)
  // 這裡假設後端還沒實作 Excel 匯出，暫時用 CSV 替代或提示
  // window.location.href = exportUrl;
  alert("Excel 匯出功能需後端支援，目前建議使用 CSV 匯出功能。");
}

// **🔹 匯出為 CSV**
function exportToCSV() {
  const table = document.getElementById("history-data");
  if (
    !table ||
    table.rows.length === 0 ||
    table.rows[0].innerText.includes("無點名資料")
  ) {
    alert("⚠️ 無可匯出的歷史紀錄");
    return;
  }

  // 加入 BOM (\uFEFF) 讓 Excel 開啟時能正確識別 UTF-8 中文
  let csvContent = "\uFEFF日期,房號,學生姓名,狀態\n";

  for (let row of table.rows) {
    let rowData = [];
    for (let cell of row.cells) {
      let text = cell.textContent.replace(/"/g, '""'); // 處理雙引號
      rowData.push(`"${text}"`);
    }
    csvContent += rowData.join(",") + "\n";
  }

  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);

  link.setAttribute("href", url);
  link.setAttribute(
    "download",
    `attendance_history_${new Date().toISOString().slice(0, 10)}.csv`
  );
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
