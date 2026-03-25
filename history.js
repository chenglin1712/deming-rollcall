// ── 分頁狀態 ──────────────────────────────
let currentPage = 1;
let totalPages  = 1;
const PAGE_SIZE = 50;

// ── 初始化 ────────────────────────────────
document.addEventListener("DOMContentLoaded", function () {
  loadGroupOptions();
  loadDateOptions(); // 載入後自動選最新日期並查詢

  document.getElementById("filter-btn").addEventListener("click", () => {
    currentPage = 1;
    loadHistoryData();
  });

  document.getElementById("prev-btn").addEventListener("click", () => {
    if (currentPage > 1) { currentPage--; loadHistoryData(); }
  });

  document.getElementById("next-btn").addEventListener("click", () => {
    if (currentPage < totalPages) { currentPage++; loadHistoryData(); }
  });

  document.getElementById("export-excel-btn").addEventListener("click", exportToExcel);
  document.getElementById("export-csv-btn").addEventListener("click", exportToCSV);

  const clearBtn = document.getElementById("clear-btn");
  if (clearBtn) clearBtn.addEventListener("click", clearAllHistory);
});

// ── 載入日期選項（自動選最新日並查詢）────
function loadDateOptions() {
  fetch("/api/attendance/dates")
    .then(res => {
      if (!res.ok) throw new Error();
      return res.json();
    })
    .then(dates => {
      const dateSelect = document.getElementById("date-select");
      dateSelect.innerHTML = '<option value="">-- 全部日期 --</option>';

      dates.forEach(date => {
        const option = document.createElement("option");
        option.value = date;
        option.textContent = new Date(date + "T00:00:00").toLocaleDateString("zh-TW", {
          year: "numeric", month: "long", day: "numeric", weekday: "short",
        });
        dateSelect.appendChild(option);
      });

      if (dates.length > 0) {
        dateSelect.value = dates[0]; // 自動選最新日
        loadHistoryData();
      } else {
        showPlaceholder("目前尚無任何點名紀錄");
      }
    })
    .catch(() => showPlaceholder("無法載入日期列表，請重新整理"));
}

// ── 載入群組選項 ──────────────────────────
function loadGroupOptions() {
  fetch("/api/groups")
    .then(res => res.json())
    .then(groups => {
      const groupSelect = document.getElementById("group-select");
      groupSelect.innerHTML = '<option value="">全部群組</option>';
      groups.forEach(group => {
        const option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        groupSelect.appendChild(option);
      });
    })
    .catch(() => console.error("無法載入群組"));
}

// ── 查詢歷史資料（分頁）─────────────────
function loadHistoryData() {
  const date  = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value.trim();

  const params = new URLSearchParams({ page: currentPage, pageSize: PAGE_SIZE });
  if (date)  params.append("date",  date);
  if (group) params.append("group", group);

  showPlaceholder("載入中...");
  document.getElementById("summary-section").style.display = "none";
  document.getElementById("pagination-bar").classList.add("hidden");

  fetch(`/api/attendance/history?${params}`)
    .then(res => res.json())
    .then(data => {
      if (!data.success) throw new Error(data.message);

      totalPages = data.totalPages || 1;

      renderSummary(data.summary, data.total);
      renderTable(data.data);
      renderPagination(data.page, data.totalPages, data.total);
    })
    .catch(err => {
      console.error("載入歷史資料失敗:", err);
      showPlaceholder("❌ 查詢失敗，請稍後再試");
    });
}

// ── 渲染統計摘要（全部符合筆數）─────────
function renderSummary(summary, total) {
  const section = document.getElementById("summary-section");
  if (!summary || total === 0) { section.style.display = "none"; return; }

  section.style.display = "block";
  section.innerHTML = `
    <div class="summary-bar">
      <span class="summary-chip present">在寢 ${summary["在寢"] || 0} 人</span>
      <span class="summary-chip absent">未歸 ${summary["未歸"] || 0} 人</span>
      <span class="summary-chip late">晚歸 ${summary["晚歸"] || 0} 人</span>
      <span class="summary-chip total">共 ${total} 筆記錄</span>
    </div>
  `;
}

// ── 渲染資料表格 ──────────────────────────
function renderTable(records) {
  const tableBody = document.getElementById("history-data");

  if (!records || records.length === 0) {
    showPlaceholder("🔍 此條件無點名資料");
    return;
  }

  const fragment = document.createDocumentFragment();
  records.forEach(record => {
    const row = document.createElement("tr");
    const formattedDate = new Date(record.date + "T00:00:00").toLocaleDateString("zh-TW", {
      month: "numeric", day: "numeric", weekday: "short",
    });

    if (record.status === "未歸")     row.classList.add("status-absent");
    else if (record.status === "晚歸") row.classList.add("status-late");

    row.innerHTML = `
      <td>${formattedDate}</td>
      <td>${record.roomNumber || "—"}</td>
      <td>${record.studentName}</td>
      <td class="action-cell">
        <select class="status-select" data-id="${record.student_id}" data-date="${record.date}">
          <option value="在寢"  ${record.status === "在寢"  ? "selected" : ""}>在寢</option>
          <option value="未歸"  ${record.status === "未歸"  ? "selected" : ""}>未歸</option>
          <option value="晚歸"  ${record.status === "晚歸"  ? "selected" : ""}>晚歸</option>
        </select>
        <button class="btn-inline-save"   onclick="saveStatus(this)">儲存</button>
        <button class="btn-inline-delete" onclick="deleteRecord('${record.student_id}', '${record.date}', this)">刪除</button>
      </td>
    `;
    fragment.appendChild(row);
  });

  tableBody.innerHTML = "";
  tableBody.appendChild(fragment);
}

// ── 渲染分頁控制列 ────────────────────────
function renderPagination(page, tPages, total) {
  const bar = document.getElementById("pagination-bar");
  if (!tPages || tPages <= 1) { bar.classList.add("hidden"); return; }

  bar.classList.remove("hidden");
  const start = (page - 1) * PAGE_SIZE + 1;
  const end   = Math.min(page * PAGE_SIZE, total);
  document.getElementById("page-info").textContent =
    `第 ${page} / ${tPages} 頁（顯示第 ${start}–${end} 筆，共 ${total} 筆）`;
  document.getElementById("prev-btn").disabled = page <= 1;
  document.getElementById("next-btn").disabled = page >= tPages;
}

// ── 顯示空狀態訊息 ────────────────────────
function showPlaceholder(msg) {
  document.getElementById("history-data").innerHTML =
    `<tr><td colspan="4" class="table-placeholder">${msg}</td></tr>`;
}

// ── 修改單筆狀態 ──────────────────────────
function saveStatus(btn) {
  const select     = btn.previousElementSibling;
  const student_id = select.dataset.id;
  const date       = select.dataset.date;
  const status     = select.value;

  fetch("/api/attendance/update", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ student_id, date, status }),
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) {
        const row = btn.closest("tr");
        row.className = "";
        if (status === "未歸")     row.classList.add("status-absent");
        else if (status === "晚歸") row.classList.add("status-late");
      } else {
        alert("❌ 更新失敗：" + data.error);
      }
    })
    .catch(() => alert("❌ 無法連線伺服器"));
}

// ── 刪除單筆紀錄 ──────────────────────────
function deleteRecord(student_id, date, btn) {
  if (!confirm("確定要刪除此筆紀錄嗎？")) return;

  fetch(`/api/attendance/delete?student_id=${encodeURIComponent(student_id)}&date=${encodeURIComponent(date)}`, {
    method: "DELETE",
  })
    .then(res => res.json())
    .then(data => {
      if (data.success) btn.closest("tr").remove();
      else alert("❌ 刪除失敗：" + data.error);
    })
    .catch(() => alert("❌ 無法連線伺服器"));
}

// ── 清空所有紀錄 ──────────────────────────
function clearAllHistory() {
  if (!confirm("⚠️ 嚴重警告：\n\n這將會「永久刪除」所有點名紀錄！\n\n此操作無法復原，確定要繼續嗎？")) return;
  if (!confirm("🚨 最後確認：\n\n真的要清空所有資料嗎？")) return;

  fetch("/api/attendance/clear", { method: "DELETE" })
    .then(res => res.json())
    .then(data => {
      if (data.success) { alert("✅ " + data.message); window.location.reload(); }
      else alert("❌ 清除失敗: " + data.message);
    })
    .catch(() => alert("❌ 無法連接伺服器"));
}

// ── 匯出 CSV（呼叫 API 取全部符合資料）──
function exportToCSV() {
  const date  = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  const params = new URLSearchParams({ pageSize: 9999 });
  if (date)  params.append("date",  date);
  if (group) params.append("group", group);

  fetch(`/api/attendance/history?${params}`)
    .then(res => res.json())
    .then(data => {
      if (!data.success || data.data.length === 0) {
        alert("⚠️ 無可匯出的歷史紀錄");
        return;
      }

      let csv = "\uFEFF日期,房號,學生姓名,狀態\n";
      data.data.forEach(r => {
        const d = new Date(r.date + "T00:00:00").toLocaleDateString("zh-TW");
        csv += `"${d}","${r.roomNumber || ""}","${r.studentName}","${r.status}"\n`;
      });

      const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
      const link = document.createElement("a");
      link.href = URL.createObjectURL(blob);
      link.download = date
        ? `attendance_${date}${group ? "_" + group : ""}.csv`
        : `attendance_all_${new Date().toLocaleDateString("sv-SE")}.csv`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    })
    .catch(() => alert("❌ 匯出失敗，請稍後再試"));
}

// ── 匯出 Excel（後端產生）────────────────
function exportToExcel() {
  const date  = document.getElementById("date-select").value;
  const group = document.getElementById("group-select").value;

  if (!date) {
    alert("請先選擇日期才能匯出 Excel");
    return;
  }

  let url = `/api/attendance/export?date=${encodeURIComponent(date)}`;
  if (group) url += `&group=${encodeURIComponent(group)}`;
  window.location.href = url;
}
