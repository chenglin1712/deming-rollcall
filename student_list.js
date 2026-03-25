document.addEventListener("DOMContentLoaded", () => {
  const groupSelect = document.getElementById("groupSelect");
  const studentTableBody = document.getElementById("studentTableBody");
  const studentSearch = document.getElementById("studentSearch"); // 🔍 新增

  // 1. 取得學生群組列表
  fetch("/api/groups")
    .then((response) => response.json())
    .then((groups) => {
      if (groups.length === 0) {
        groupSelect.innerHTML = "<option value=''>無可用群組</option>";
        return;
      }
      groups.forEach((group) => {
        let option = document.createElement("option");
        option.value = group;
        option.textContent = group;
        groupSelect.appendChild(option);
      });
    })
    .catch((error) => console.error("❌ 無法載入群組:", error));

  // 2. 當選擇群組時，載入該群組的學生名單
  groupSelect.addEventListener("change", () => {
    const group = groupSelect.value;

    // 清空搜尋框，避免混淆
    studentSearch.value = "";

    if (!group) {
      studentTableBody.innerHTML =
        "<tr><td colspan='4'>請選擇群組以顯示學生</td></tr>";
      return;
    }

    fetch(`/api/students/all?group=${encodeURIComponent(group)}`)
      .then((response) => response.json())
      .then((students) => {
        console.log("📞 後端返回的學生數據:", students);
        studentTableBody.innerHTML = ""; // 清空表格
        if (students.length === 0) {
          studentTableBody.innerHTML =
            "<tr><td colspan='4'>該群組無學生資料</td></tr>";
          return;
        }
        const fragment = document.createDocumentFragment();
        students.forEach((student) => {
          const phoneNumber = student.phoneNumber || "無資料";
          const tr = document.createElement("tr");
          tr.innerHTML = `
            <td>${student.id}</td>
            <td>${student.name}</td>
            <td>${student.roomNumber}</td>
            <td>${phoneNumber}</td>
          `;
          fragment.appendChild(tr);
        });
        studentTableBody.appendChild(fragment);
      })
      .catch((error) => {
        console.error("❌ 無法載入學生名單:", error);
        studentTableBody.innerHTML = "<tr><td colspan='4'>載入失敗</td></tr>";
      });
  });

  // 3. 🔍 新增：學號搜尋功能
  studentSearch.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      const id = studentSearch.value.trim();
      if (!id) return;

      // 重置群組選單，表示現在是搜尋模式
      groupSelect.value = "";
      studentTableBody.innerHTML = "<tr><td colspan='4'>🔍 搜尋中...</td></tr>";

      fetch(`/api/student/search?id=${encodeURIComponent(id)}`)
        .then((response) => response.json())
        .then((result) => {
          studentTableBody.innerHTML = ""; // 清空表格

          if (result.success) {
            // API 回傳的是單筆資料 { success: true, data: { ... } }
            const student = result.data;
            appendStudentRow(student);
          } else {
            studentTableBody.innerHTML = `<tr><td colspan='4' style='color: red;'>❌ 找不到學號為 ${id} 的學生</td></tr>`;
          }
        })
        .catch((error) => {
          console.error("搜尋錯誤:", error);
          studentTableBody.innerHTML =
            "<tr><td colspan='4'>搜尋發生錯誤</td></tr>";
        });
    }
  });

  // 🛠 輔助函式：將學生資料加入表格
  function appendStudentRow(student) {
    const phoneNumber = student.phoneNumber || "無資料";
    const groupInfo = student.group_name
      ? `<br><small style='color: gray'>(${student.group_name})</small>`
      : "";

    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${student.id}</td>
      <td>${student.name}</td>
      <td>${student.roomNumber}${groupInfo}</td>
      <td>${phoneNumber}</td>
    `;
    studentTableBody.appendChild(tr);
  }
});
