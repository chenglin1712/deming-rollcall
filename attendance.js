document.addEventListener("DOMContentLoaded", function () {
  // 獲取URL參數中的群組名稱
  const urlParams = new URLSearchParams(window.location.search);
  const groupName = urlParams.get("group");

  // 設置頁面標題
  document.getElementById("group-title").textContent =
    groupName || "未指定群組";

  // 設置當前日期
  const currentDate = new Date();
  const dateOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  };
  document.getElementById("current-date").textContent =
    currentDate.toLocaleDateString("zh-TW", dateOptions);

  // 載入該群組的學生列表
  loadStudents(groupName);

  // 綁定提交按鈕事件
  document
    .getElementById("submit-btn")
    .addEventListener("click", submitAttendance);
});

// 從資料庫載入學生列表
function loadStudents(groupName) {
  // 實際應用中，這裡應該向後端API發送請求獲取學生列表
  // 這裡使用模擬數據進行演示

  fetch(`/api/students?group=${encodeURIComponent(groupName)}`)
    .then((response) => response.json())
    .then((students) => {
      displayStudents(students);
    })
    .catch((error) => {
      console.error("載入學生數據時出錯:", error);
      // 顯示錯誤訊息
      document.getElementById(
        "student-list"
      ).innerHTML = `<div class="error-message">載入學生列表失敗。請確認資料庫連接正常。</div>`;
    });
}

// 顯示學生列表
function displayStudents(students) {
  const studentList = document.getElementById("student-list");
  const template = document.getElementById("student-row-template");

  // 清空現有列表
  studentList.innerHTML = "";

  if (students.length === 0) {
    studentList.innerHTML =
      '<div class="empty-message">此群組沒有學生數據</div>';
    return;
  }

  // 遍歷學生數據，創建點名行
  students.forEach((student) => {
    const row = template.content.cloneNode(true);

    // 設置房號和姓名
    row.querySelector(".room-number").textContent = student.roomNumber;
    row.querySelector(".student-name").textContent = student.name;

    // 設置單選按鈕名稱，確保每個學生的選項是一組
    const radioName = `status-${student.id}`;
    const radioButtons = row.querySelectorAll('input[type="radio"]');
    radioButtons.forEach((radio) => {
      radio.name = radioName;
      radio.dataset.studentId = student.id;
    });

    // 默認選擇"在寢"
    row.querySelector('input[value="在寢"]').checked = true;

    studentList.appendChild(row);
  });
}

// 提交點名數據
function submitAttendance() {
  const urlParams = new URLSearchParams(window.location.search);
  const groupName = urlParams.get("group");
  const currentDate = new Date().toISOString().split("T")[0]; // 格式: YYYY-MM-DD

  const attendanceData = [];
  const studentRows = document.querySelectorAll(".student-row");

  studentRows.forEach((row) => {
    const studentId = row.querySelector('input[type="radio"]').dataset
      .studentId;
    const status = row.querySelector('input[type="radio"]:checked').value;
    const roomNumber = row.querySelector(".room-number").textContent;
    const name = row.querySelector(".student-name").textContent;

    attendanceData.push({
      date: currentDate,
      studentId: studentId,
      name: name,
      roomNumber: roomNumber,
      status: status,
      group: groupName,
    });
  });

  // 發送數據到伺服器
  fetch("/api/attendance", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      date: currentDate,
      group: groupName,
      data: attendanceData,
    }),
  })
    .then((response) => response.json())
    .then((result) => {
      if (result.success) {
        alert("點名紀錄已成功儲存！");
        // 重定向到首頁
        window.location.href = "index.html";
      } else {
        alert(`保存失敗: ${result.message}`);
      }
    })
    .catch((error) => {
      console.error("提交點名數據時出錯:", error);
      alert("保存點名紀錄時發生錯誤，請稍後再試。");
    });
}
