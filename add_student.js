document.addEventListener("DOMContentLoaded", function () {
  // 綁定表單提交事件
  const form = document.getElementById("add-student-form");
  form.addEventListener("submit", submitStudentForm);
});

// 提交學生表單
function submitStudentForm(event) {
  event.preventDefault();

  // 獲取表單數據
  const studentId = document.getElementById("student-id").value;
  const studentName = document.getElementById("student-name").value;
  const roomNumber = document.getElementById("room-number").value;
  const phoneNumber = document.getElementById("phone-number").value;
  const group = document.getElementById("group").value;

  // 驗證表單
  if (!studentId || !studentName || !roomNumber || !phoneNumber || !group) {
    alert("請填寫所有欄位");
    return;
  }

  // 創建學生數據對象
  const studentData = {
    id: studentId,
    name: studentName,
    roomNumber: roomNumber,
    phoneNumber: phoneNumber,
    group: group,
  };

  // 發送數據到伺服器
  fetch("/api/students", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(studentData),
  })
    .then((response) => response.json())
    .then((result) => {
      if (result.success) {
        alert("學生資訊已成功新增！");
        // 重置表單
        document.getElementById("add-student-form").reset();
      } else {
        alert(`新增失敗: ${result.message}`);
      }
    })
    .catch((error) => {
      console.error("新增學生資訊時出錯:", error);
      alert("新增學生資訊時發生錯誤，請稍後再試。");
    });
}
