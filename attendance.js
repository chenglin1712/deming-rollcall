// 點名頁狀態
let attendanceDate = null; // 由伺服器 check API 決定的業務日期（不使用裝置系統時間）
let isSubmitting = false;

// 點名中，防止誤觸返回/關閉（具名函式，離開頁面前才能真正移除）
function onBeforeUnload(e) {
  e.preventDefault();
  e.returnValue = "";
}

function leaveToHome() {
  window.removeEventListener("beforeunload", onBeforeUnload);
  window.location.href = "index.html";
}

function showListMessage(className, text) {
  const list = document.getElementById("student-list");
  list.innerHTML = "";
  const div = document.createElement("div");
  div.className = className;
  div.textContent = text;
  list.appendChild(div);
}

document.addEventListener("DOMContentLoaded", function () {
  const urlParams = new URLSearchParams(window.location.search);
  const groupName = urlParams.get("group");

  if (!groupName) {
    console.warn("⚠️ 未提供群組名稱，請檢查 URL 是否正確");
    document.getElementById("group-title").textContent = "未指定群組";
    showListMessage("error-message", "群組名稱遺失，無法載入學生列表。");
    return;
  }

  console.log("✅ 選擇的群組名稱:", groupName);
  document.getElementById("group-title").textContent = groupName;

  // 補點名帶 date 參數；今日點名不帶，由伺服器決定今天
  const dateParam = urlParams.get("date");
  const checkUrl =
    `/api/attendance/check?group=${encodeURIComponent(groupName)}` +
    (dateParam ? `&date=${encodeURIComponent(dateParam)}` : "");

  setSubmitButtonsDisabled(true);

  fetch(checkUrl)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((result) => {
      attendanceDate = result.date;
      document.getElementById("current-date").textContent = attendanceDate;

      // 全員都已點名的群組不允許再進入（避免重複點名）
      if (result.completed) {
        alert(`「${groupName}」在 ${attendanceDate} 已完成點名，無法重複點名。`);
        leaveToHome();
        return;
      }
      // 部分點名（例如補點名只補了一部分）時，只列出尚未點名的學生
      loadStudents(groupName, new Set(result.marked_ids || []));
    })
    .catch((error) => {
      // 無法確認點名狀態時不開放點名，避免在不確定的情況下重複點名
      console.error("❌ 檢查點名狀態失敗:", error);
      showListMessage("error-message", "⚠️ 無法確認點名狀態，請重新整理頁面後再試。");
    });

  document.getElementById("submit-btn").addEventListener("click", () => {
    submitAttendance(groupName);
  });

  document.getElementById("all-present-btn").addEventListener("click", () => {
    if (isSubmitting) return;
    if (!confirm("確定將所有學生標記為「在寢」並送出？")) return;
    document.querySelectorAll('input[type="radio"][value="在寢"]').forEach((r) => {
      r.checked = true;
    });
    submitAttendance(groupName);
  });
});

function setSubmitButtonsDisabled(disabled) {
  ["submit-btn", "all-present-btn"].forEach((id) => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = disabled;
  });
}

function loadStudents(groupName, markedIds) {
  fetch(`/api/students/all?group=${encodeURIComponent(groupName)}`)
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return response.json();
    })
    .then((students) => {
      console.log("✅ 取得的學生名單:", students);
      const pending = (students || []).filter((s) => !markedIds.has(s.id));
      if (!students || students.length === 0) {
        showListMessage("empty-message", "⚠️ 此群組沒有學生數據");
        return;
      }
      if (pending.length === 0) {
        showListMessage("empty-message", "此群組所有學生均已點名");
        return;
      }
      displayStudents(pending);
      setSubmitButtonsDisabled(false);
      // 有可提交的表單時才啟用離頁確認
      window.addEventListener("beforeunload", onBeforeUnload);
    })
    .catch((error) => {
      console.error("❌ 載入學生數據時出錯:", error);
      showListMessage("error-message", "⚠️ 無法載入學生列表，請確認 API 連線正常。");
    });
}

function displayStudents(students) {
  const studentList = document.getElementById("student-list");
  const template = document.getElementById("student-row-template");

  studentList.innerHTML = ""; // 清空內容

  students.forEach((student) => {
    const row = template.content.cloneNode(true);

    row.querySelector(".room-number").textContent = student.roomNumber;
    row.querySelector(".student-name").textContent = student.name;

    const radioName = `status-${student.id}`;
    row.querySelectorAll('input[type="radio"]').forEach((radio) => {
      radio.name = radioName;
      radio.dataset.studentId = student.id;
      radio.dataset.studentName = student.name; // 新增學生姓名 dataset
    });

    row.querySelector('input[value="在寢"]').checked = true; // 預設選擇「在寢」
    studentList.appendChild(row);
  });

  console.log("✅ 學生列表成功渲染！");
}

function submitAttendance(groupName) {
  if (isSubmitting) return;

  const attendanceData = [];

  document.querySelectorAll(".student-row").forEach((row) => {
    const studentId = row.querySelector('input[type="radio"]').dataset
      .studentId;
    const studentName = row.querySelector(".student-name").textContent.trim(); // 取得學生姓名
    const status = row.querySelector('input[type="radio"]:checked').value;

    attendanceData.push({
      student_id: studentId,
      studentName: studentName,
      status,
    });
  });

  if (attendanceData.length === 0 || !attendanceDate) {
    alert("⚠️ 沒有學生資料可提交！");
    return;
  }

  // 送出中鎖定按鈕，避免連點造成重複送出
  isSubmitting = true;
  setSubmitButtonsDisabled(true);

  fetch("/api/attendance/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date: attendanceDate, group: groupName, attendanceData }),
  })
    .then((response) =>
      response
        .json()
        .catch(() => ({}))
        .then((data) => ({ data, status: response.status }))
    )
    .then(({ data, status }) => {
      if (data.success) {
        alert(
          data.skipped > 0
            ? `✅ 點名成功！（有 ${data.skipped} 位學生剛剛已被點名，已略過）`
            : "✅ 點名成功！"
        );
        leaveToHome();
      } else if (status === 409) {
        alert("⚠️ " + data.error);
        leaveToHome();
      } else {
        throw new Error(data.error || `HTTP ${status}`);
      }
    })
    .catch((error) => {
      console.error("❌ 點名提交失敗:", error);
      alert("❌ 點名失敗：" + (error.message || "請稍後重試"));
      isSubmitting = false;
      setSubmitButtonsDisabled(false);
    });
}
