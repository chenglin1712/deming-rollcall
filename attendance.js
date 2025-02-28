document.addEventListener("DOMContentLoaded", function () {
  const urlParams = new URLSearchParams(window.location.search);
  let groupName = urlParams.get("group");

  if (!groupName) {
    console.warn("⚠️ 未提供群組名稱，請檢查 URL 是否正確");
    document.getElementById("group-title").textContent = "未指定群組";
    document.getElementById("student-list").innerHTML =
      '<div class="error-message">群組名稱遺失，無法載入學生列表。</div>';
    return;
  }

  console.log("✅ 選擇的群組名稱:", groupName);
  document.getElementById("group-title").textContent = groupName;

  const currentDate = new Date();
  const dateOptions = {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  };
  document.getElementById("current-date").textContent =
    currentDate.toLocaleDateString("zh-TW", dateOptions);

  loadStudents(groupName);

  document
    .getElementById("submit-btn")
    .addEventListener("click", submitAttendance);
});

function loadStudents(groupName) {
  // **自動偵測 API URL**
  const backendURL = window.location.origin.includes("ngrok-free.app")
    ? window.location.origin
    : "http://192.168.0.115:3000"; // 根據當前網址選擇 API 來源

  console.log("🌍 API 請求網址:", backendURL);

  fetch(`${backendURL}/api/students?group=${encodeURIComponent(groupName)}`)
    .then((response) => {
      if (!response.ok) {
        throw new Error(`❌ API 回應錯誤: ${response.status}`);
      }
      return response.json();
    })
    .then((students) => {
      console.log("✅ API 回傳的學生資料:", students);
      if (!students || students.length === 0) {
        document.getElementById("student-list").innerHTML =
          '<div class="empty-message">此群組沒有學生數據</div>';
        return;
      }
      displayStudents(students);
    })
    .catch((error) => {
      console.error("❌ 載入學生數據時出錯:", error);
      document.getElementById(
        "student-list"
      ).innerHTML = `<div class="error-message">載入學生列表失敗，請確認 API 連線正常。</div>`;
    });
}

function displayStudents(students) {
  const studentList = document.getElementById("student-list");
  const template = document.getElementById("student-row-template");

  if (!template) {
    console.error(
      "❌ 找不到 #student-row-template，請確認 attendance.html 是否正確"
    );
    return;
  }

  studentList.innerHTML = "";

  students.forEach((student) => {
    console.log("📝 處理學生:", student);
    const row = template.content.cloneNode(true);

    row.querySelector(".room-number").textContent = student.roomNumber;
    row.querySelector(".student-name").textContent = student.name;

    const radioName = `status-${student.id}`;
    const radioButtons = row.querySelectorAll('input[type="radio"]');
    radioButtons.forEach((radio) => {
      radio.name = radioName;
      radio.dataset.studentId = student.id;
    });

    row.querySelector('input[value="在寢"]').checked = true;
    studentList.appendChild(row);
  });
}
