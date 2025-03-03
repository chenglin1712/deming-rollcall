document.addEventListener("DOMContentLoaded", function () {
  const urlParams = new URLSearchParams(window.location.search);
  const groupName = urlParams.get("group");

  if (!groupName) {
    console.warn("⚠️ 未提供群組名稱，請檢查 URL 是否正確");
    document.getElementById("group-title").textContent = "未指定群組";
    document.getElementById("student-list").innerHTML =
      '<div class="error-message">群組名稱遺失，無法載入學生列表。</div>';
    return;
  }

  console.log("✅ 選擇的群組名稱:", groupName);
  document.getElementById("group-title").textContent = groupName;

  // 設定當前日期
  const currentDate = new Date().toISOString().split("T")[0]; // YYYY-MM-DD
  document.getElementById("current-date").textContent = currentDate;

  loadStudents(groupName);

  document.getElementById("submit-btn").addEventListener("click", () => {
    submitAttendance(groupName, currentDate);
  });
});

function loadStudents(groupName) {
  fetch(`/api/students/all?group=${encodeURIComponent(groupName)}`)
    .then((response) => response.json())
    .then((students) => {
      console.log("✅ 取得的學生名單:", students);
      if (!students || students.length === 0) {
        document.getElementById("student-list").innerHTML =
          '<div class="empty-message">⚠️ 此群組沒有學生數據</div>';
        return;
      }
      displayStudents(students);
    })
    .catch((error) => {
      console.error("❌ 載入學生數據時出錯:", error);
      document.getElementById("student-list").innerHTML =
        '<div class="error-message">⚠️ 無法載入學生列表，請確認 API 連線正常。</div>';
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

function submitAttendance(groupName, date) {
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

  if (attendanceData.length === 0) {
    alert("⚠️ 沒有學生資料可提交！");
    return;
  }

  fetch("/api/attendance/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ date, group: groupName, attendanceData }),
  })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert("✅ 點名成功！");
        window.location.href = "index.html";
      } else {
        alert("❌ 點名失敗，請稍後重試！");
      }
    })
    .catch((error) => {
      console.error("❌ 點名提交失敗:", error);
      alert("⚠️ 伺服器錯誤，無法提交點名！");
    });
}
